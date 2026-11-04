"""Read-only client for the Freedom24 (Tradernet) API.

THIS CLIENT CAN NEVER TRADE. Every request goes through `_call`, which refuses any command that is
not in `READ_ONLY_COMMANDS` before anything is signed or sent. There is deliberately no public
"call any command" method, no order/stop/cancel helpers, and nothing else in the project (the AI
features included) is given the keys. To add a new command it must be a read command, added to the
allowlist by hand, and covered by tests/test_freedom24_readonly.py, which fails if any trading
command ever lands in the allowlist.

Protocol (from the official tradernet-sdk 2.2.0, API v3): POST https://freedom24.com/api/{cmd}
with the JSON params as the body; headers X-NtApi-PublicKey, X-NtApi-Timestamp (unix seconds) and
X-NtApi-Sig = HMAC-SHA256(private key, body + timestamp) as hex.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "https://freedom24.com/api"

# What the project may ask the broker. Reads only: positions, cash, trades, reports, prices.
READ_ONLY_COMMANDS: frozenset[str] = frozenset(
    {
        "getPositionJson",  # portfolio: positions, cash balances, active orders (read)
        "getTradesHistory",  # executed trades with commissions
        "getOrdersHistory",  # past orders (read)
        "getBrokerReport",  # deposits/withdrawals, dividends, taxes, commissions, corporate actions
        "getHloc",  # historical candles
        "getStockQuotesJson",  # quotes for a list of tickers
        "getSecurityInfo",  # security details
        "getPlannedCorpActions",  # upcoming dividends and other corporate actions
        "getMarketStatus",  # exchange open/closed
    }
)

# Commands that place, change or cancel orders, or move money. Never allowed; listed so tests and
# readers can see them, and as a second check in `_call` in case someone edits the allowlist.
TRADING_COMMANDS: frozenset[str] = frozenset(
    {
        "putTradeOrder",
        "putStopLoss",
        "delTradeOrder",
        "sendOrder",
        "putOrder",
        "deleteOrder",
        "addPriceAlert",
        "registerNewUser",
    }
)


class Freedom24Error(RuntimeError):
    pass


class TradingForbidden(PermissionError):
    """Raised for any command that is not a whitelisted read."""


def _sign(private_key: str, message: str) -> str:
    return hmac.new(private_key.encode(), message.encode(), hashlib.sha256).hexdigest()


class Freedom24ReadOnly:
    def __init__(self, public_key: str, private_key: str, timeout: float = 20.0) -> None:
        if not public_key.strip() or not private_key.strip():
            raise Freedom24Error("FREEDOM24_PUBLIC_KEY and FREEDOM24_PRIVATE_KEY must be set in back/.env.")
        self._public = public_key.strip()
        self._private = private_key.strip()
        self._timeout = timeout

    def __repr__(self) -> str:  # never print the keys
        return f"Freedom24ReadOnly(public=***{self._public[-4:]})"

    # ---- The only way out to the broker ----

    def _call(self, cmd: str, params: dict[str, Any] | None = None, timeout: float | None = None) -> Any:
        if cmd in TRADING_COMMANDS or cmd not in READ_ONLY_COMMANDS:
            raise TradingForbidden(f"Freedom24 command {cmd!r} is not an allowed read-only command.")
        body = json.dumps(params or {}, separators=(",", ":"))
        timestamp = str(int(time.time()))
        request = Request(
            f"{BASE_URL}/{cmd}",
            data=body.encode(),
            method="POST",
            headers={
                # Cloudflare in front of the API rejects urllib's default User-Agent (error 1010).
                "User-Agent": "olivia/1.0 (personal dashboard)",
                "Content-Type": "application/json",
                "X-NtApi-PublicKey": self._public,
                "X-NtApi-Timestamp": timestamp,
                "X-NtApi-Sig": _sign(self._private, body + timestamp),
            },
        )
        try:
            with urlopen(request, timeout=timeout or self._timeout) as res:
                data = json.loads(res.read().decode("utf-8"))
        except HTTPError as exc:
            raise Freedom24Error(f"Freedom24 {cmd}: HTTP {exc.code}") from exc
        except (URLError, TimeoutError) as exc:
            raise Freedom24Error(f"Freedom24 {cmd}: could not reach the API") from exc
        # Errors come back as {"error": …} (current docs) or {"errMsg": …} (older responses).
        if isinstance(data, dict) and (data.get("error") or data.get("errMsg")):
            raise Freedom24Error(f"Freedom24 {cmd}: {data.get('error') or data.get('errMsg')}")
        return data

    # ---- Reads ----

    def portfolio(self) -> Any:
        """Positions, cash balances by currency and active orders."""
        return self._call("getPositionJson")

    def trades(self, start: str = "1970-01-01", end: str | None = None) -> Any:
        """Executed trades (ISO dates)."""
        return self._call("getTradesHistory", {"beginDate": start, "endDate": end or time.strftime("%Y-%m-%d")})

    def broker_report(self, part: str, start: str = "1970-01-01", end: str | None = None) -> Any:
        """One part of the broker report: account_at_start, account_at_end, trades, commissions,
        corporate_actions, in_outs, in_outs_securities, cash_flows or securities_flows."""
        return self._call(
            "getBrokerReport",
            {
                "date_start": start,
                "date_end": end or time.strftime("%Y-%m-%d"),
                "time_period": "23:59:59",
                "format": "json",
                "type": part,
            },
        )

    def corporate_actions(self, reception: int = 35) -> Any:
        """All corporate actions (dividends, splits…) the broker's office has planned or recorded. The answer is
        large (hundreds of thousands of rows, ~30 s), so callers cache it."""
        return self._call("getPlannedCorpActions", {"reception": reception}, timeout=120)

    def quotes(self, symbols: list[str]) -> Any:
        """Real-time quotes for broker symbols ("AAPL.US"): last price, day change, 52-week range…"""
        return self._call("getStockQuotesJson", {"tickers": ",".join(symbols)})

    def candles(self, symbol: str, date_from: str, date_to: str, minutes: int = 1440) -> Any:
        """Price candles (open/high/low/close, volume) for a broker symbol; dates as "DD.MM.YYYY HH:MM"."""
        return self._call(
            "getHloc",
            {"id": symbol, "count": -1, "timeframe": minutes, "date_from": date_from, "date_to": date_to, "intervalMode": "OpenRay"},
            timeout=60,
        )
