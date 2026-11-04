"""Freedom24 as the source of the Investing data: trades, deposits, dividends, cash and positions.

Everything here READS the broker (through Freedom24ReadOnly, which cannot trade) and reshapes the answers
into the app's own formats, so the pages work unchanged. What only you know stays in the database:
targets, industries and names of holdings; the hand-kept history is kept in investing_manual_archive.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from app.broker.freedom24 import Freedom24ReadOnly
from app.investing.router import _fetch_fx_rate_to_usd, _to_trade_currency

_TTL = 300.0  # seconds: the broker's history changes rarely; pages load several endpoints at once
_cache: dict[str, tuple[float, Any]] = {}
_lock = threading.Lock()
_corp_refreshing = False
_log = logging.getLogger("olivia.freedom24")

DEPOSIT_TYPES = {"card", "bank", "digital_assets", "internal_holding"}
BENCHMARKS = {"SPY", "VOO", "QQQ", "VT"}  # funds the Analytics page can compare against
_QUOTE_TTL = 15.0  # live prices: fresh, but one broker call serves the several requests a page makes at once

# Planned corporate actions: the broker's list is huge and slow (~30 s), so the upcoming dividends are kept on
# disk for half a day. Serverless (Vercel) can only write to /tmp.
_CORP_TTL = 12 * 60 * 60
_CORP_FILE = Path(
    os.environ.get("OLIVIA_CACHE_DIR") or ("/tmp/olivia" if os.environ.get("VERCEL") else Path(__file__).resolve().parents[2] / ".cache")
) / "f24_planned_dividends.json"
_START = "2010-01-01"


def plain_ticker(symbol: str) -> str:
    """'AAPL.US' -> 'AAPL'; 'GOLD_OLD.US' (renamed company, old ticker) -> 'GOLD'; other markets keep their suffix."""
    t = str(symbol or "").strip().upper()
    if t.endswith(".US"):
        t = t[:-3]
    return re.sub(r"_OLD$", "", t)


def _ddmmyyyy(iso: str) -> str:
    y, m, d = iso[:10].split("-")
    return f"{d}.{m}.{y}"


def _f(v: Any) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _money(v: float) -> str:
    return f"-${abs(v):,.2f}" if v < 0 else f"${v:,.2f}"


def _norm_ccy(c: Any) -> str:
    c = str(c or "USD").strip().upper()
    return "RUB" if c == "RUR" else c


def _trade_iso(t: dict) -> str:
    # The trade's own date ("2023-02-09 23:15:32"); short_date can be the next day for evening US trades.
    return str(t.get("date") or t.get("short_date") or "")[:10]


def _days_between(a: str, b: str) -> int:
    from datetime import date

    return (date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days


_TICKER_IN_COMMENT = re.compile(r"\(([A-Z0-9_.\-]+)\)|on share ([A-Z0-9_.\-]+)")


class Freedom24Source:
    def __init__(self, client: Freedom24ReadOnly) -> None:
        self._c = client

    # ---- Cached raw reads ----

    def _cached(self, key: str, fetch: Callable[[], Any], ttl: float = _TTL) -> Any:
        full = f"{self._c!r}:{key}"
        with _lock:
            hit = _cache.get(full)
            if hit and time.time() - hit[0] < ttl:
                return hit[1]
        value = fetch()
        with _lock:
            _cache[full] = (time.time(), value)
        return value

    def _report(self, part: str) -> Any:
        data = self._cached(f"report:{part}", lambda: self._c.broker_report(part, _START))
        return (data or {}).get("report") if isinstance(data, dict) else None

    def _portfolio(self) -> dict:
        data = self._cached("portfolio", self._c.portfolio)
        return ((data or {}).get("result") or {}).get("ps") or {}

    def _trades(self) -> list[dict]:
        return (self._report("trades") or {}).get("detailed") or []

    def _in_outs(self) -> list[dict]:
        return (self._report("in_outs") or {}).get("detailed") or []

    def _commissions(self) -> list[dict]:
        return (self._report("commissions") or {}).get("detailed") or []

    def _usd_rate(self, currency: str, iso: str) -> float | None:
        """USD per 1 unit of `currency` on that day: from your own exchanges at the broker (EUR/USD, RUR/USD)
        that day or within a week, else the official rate."""
        cur = _norm_ccy(currency)
        if cur == "USD":
            return 1.0
        if not hasattr(self, "_fx_days"):
            days: dict[str, dict[str, float]] = defaultdict(dict)
            for t in self._trades():
                pair = str(t.get("instr_nm") or "")
                if pair.endswith("/USD") and _f(t.get("p")):
                    days[_norm_ccy(pair[:-4])].setdefault(_trade_iso(t), _f(t.get("p")))
            self._fx_days = days
        own = self._fx_days.get(cur, {})
        if iso in own:
            return own[iso]
        near = sorted(own, key=lambda d: abs(_days_between(d, iso)))
        if near and abs(_days_between(near[0], iso)) <= 7:
            return own[near[0]]
        return _fetch_fx_rate_to_usd(cur, _ddmmyyyy(iso))

    # ---- Trades (Activities) ----

    def activities(self, known: dict[str, tuple[str, str]] | None = None) -> list[dict]:
        """Stock trades in the app's activity shape. `known`: ticker -> (name, category) from your own rows."""
        known = known or {}
        names = {plain_ticker(p.get("i", "")): str(p.get("name") or "") for p in self._portfolio().get("pos") or []}
        rows = []
        for t in self._trades():
            symbol = str(t.get("instr_nm") or "")
            if "/" in symbol:  # currency exchange (EUR/USD, RUR/USD), not a stock trade
                continue
            ticker = plain_ticker(symbol)
            iso = _trade_iso(t)
            date = _ddmmyyyy(iso)
            cur = _norm_ccy(t.get("curr_c"))
            fee = _f(t.get("commission"))
            fee_ccy = _norm_ccy(t.get("commission_currency") or cur)
            if fee and fee_ccy != cur:
                src, dst = self._usd_rate(fee_ccy, iso), self._usd_rate(cur, iso)
                fee = fee * src / dst if src and dst else _to_trade_currency(fee, fee_ccy, cur, date)
            name, category = known.get(ticker, (names.get(ticker, ""), ""))
            rows.append(
                {
                    "id": f"trade-{t.get('trade_id')}",
                    "type": "sell" if str(t.get("operation")).lower() == "sell" else "buy",
                    "name": name or ticker,
                    "ticker": ticker,
                    "category": category,
                    "count": _f(t.get("q")),
                    "price": str(_f(t.get("p"))),
                    "currency": cur,
                    "amount": str(round(_f(t.get("summ")), 2)),
                    "gains_losses": str(round(_f(t.get("profit")), 2)),
                    "commission": str(round(fee, 2)),
                    "date": date,
                }
            )
        rows.sort(key=lambda r: (r["date"][6:], r["date"][3:5], r["date"][:2]), reverse=True)
        return rows

    # ---- Deposits (Finance → Refills) ----

    def refills(self) -> list[dict]:
        """Money put into the account, in USD, with the deposit fee. Chargebacks and transfers between your own
        sub-accounts cancel out. EUR is converted at the rate of your EUR→USD exchange that day, else the official one."""
        entries = sorted(
            (r for r in self._in_outs() if r.get("type_id") in DEPOSIT_TYPES and _f(r.get("amount"))),
            key=lambda r: str(r.get("date")),
        )
        kept: list[dict] = []
        for r in entries:
            amount = _f(r.get("amount"))
            if amount < 0:
                same = lambda x: x["currency"] == r["currency"] and abs(_f(x["amount"]) + amount) < 0.01  # noqa: E731
                # A transfer between sub-accounts: "−X" and "+X" the same day. Else a chargeback of an earlier deposit.
                pair = next((x for x in kept if same(x) and str(x["date"])[:10] == str(r["date"])[:10]), None) or next(
                    (x for x in reversed(kept) if same(x)), None
                )
                if pair:
                    kept.remove(pair)
                    continue
            kept.append(r)
        fees = [c for c in self._commissions() if not str(c.get("type", "")).startswith(("For trade", "Interest"))]

        rows = []
        for i, r in enumerate(kept):
            if _f(r.get("amount")) <= 0:
                continue
            iso = str(r["date"])[:10]
            cur = _norm_ccy(r.get("currency"))
            amount = _f(r["amount"])
            rate = self._usd_rate(cur, iso) or 0.0
            # The deposit fee: an "Other fees" entry that day naming this amount.
            fee_usd = 0.0
            for c in fees:
                comment = str(c.get("comment") or "")
                if iso in comment and re.search(rf"(?<![\d.]){re.escape(f'{amount:g}')}(?![\d])", comment):
                    fee = _f(c.get("sum")) * (self._usd_rate(str(c.get("currency")), iso) or 0.0)
                    # A deposit fee is a few percent at most; a bigger one that day belongs to something else.
                    if fee <= amount * rate * 0.1:
                        fee_usd += fee
            rows.append(
                {
                    "id": f"f24-dep-{iso}-{i}",
                    "date": _ddmmyyyy(iso),
                    "amount": f"{amount * rate:.2f}",
                    "commission": f"{fee_usd:.2f}" if fee_usd else "",
                }
            )
        return rows

    def margin_interest_usd(self) -> float:
        """Interest the broker charged for using its money (a negative cash balance), in USD. Not a trade or
        deposit fee, so it shows nowhere else."""
        return sum(
            _f(c.get("sum")) * (self._usd_rate(str(c.get("currency")), str(c.get("datetime"))[:10]) or 0.0)
            for c in self._commissions()
            if str(c.get("type", "")).startswith("Interest")
        )

    def upcoming_dividends(self) -> dict[str, list[dict]]:
        """Dividends the broker has announced from today on, per ticker: ex-date, pay date and amount per share.
        Corrections and tax reclaims for past payments are left out; one row per ticker and ex-date."""
        today = date.today().isoformat()
        cached = self._corp_cache()
        if cached is None:  # first run: estimates for now, the broker's list arrives in the background
            return {}
        return {t: [d for d in rows if d["ex_date"] >= today] for t, rows in cached["dividends"].items()}

    def _corp_cache(self) -> dict | None:
        """The saved digest of the broker's corporate actions, even if old; refreshed in the background when it
        is older than half a day (the download takes ~30 s, too long to make a page wait for it)."""
        cached = None
        try:
            cached = json.loads(_CORP_FILE.read_text(encoding="utf-8"))
            if "history" not in cached:
                cached = None
        except (OSError, ValueError, KeyError, TypeError):
            cached = None
        if cached is None or time.time() - float(cached.get("at", 0)) >= _CORP_TTL:
            self._refresh_in_background()
        return cached

    def _refresh_in_background(self) -> None:
        global _corp_refreshing
        with _lock:
            if _corp_refreshing:
                return
            _corp_refreshing = True

        def run() -> None:
            global _corp_refreshing
            try:
                self._refresh_corp_cache()
            except Exception:  # noqa: BLE001 - keep serving the old digest; say why in the log
                _log.exception("Freedom24: corporate actions refresh failed")
            finally:
                with _lock:
                    _corp_refreshing = False

        threading.Thread(target=run, name="f24-corp-actions", daemon=True).start()

    def _refresh_corp_cache(self) -> dict:
        """One slow download of the broker's corporate actions, boiled down to upcoming dividends (all tickers)
        and the dividend history of the benchmark funds."""
        today = date.today().isoformat()
        reception = next((int(t["office"]) for t in self._trades() if str(t.get("office") or "").isdigit()), 35)
        actions = self._c.corporate_actions(reception)
        best: dict[tuple[str, str], dict] = {}
        history: dict[str, dict[str, float]] = defaultdict(dict)
        for a in actions if isinstance(actions, list) else []:
            bench = plain_ticker(str(a.get("ticker") or ""))
            if a.get("type") == "dividend" and bench in BENCHMARKS and _f(a.get("amount_per_one")) > 0:
                ex_day = str(a.get("ex_date") or "")[:10]
                history[bench][ex_day] = max(history[bench].get(ex_day, 0.0), _f(a.get("amount_per_one")))
            ex = str(a.get("ex_date") or "")[:10]
            if a.get("type") != "dividend" or not ex or ex < today:
                continue
            ticker = plain_ticker(str(a.get("ticker") or ""))
            amount = _f(a.get("amount_per_one"))
            key = (ticker, ex)
            if amount > 0 and (key not in best or amount > best[key]["amount"]):
                best[key] = {
                    "ex_date": ex,
                    "pay_date": str(a.get("pay_date") or "")[:10],
                    "amount": amount,
                    "currency": _norm_ccy(a.get("currency")),
                }
        out: dict[str, list[dict]] = defaultdict(list)
        for (ticker, _), row in sorted(best.items(), key=lambda kv: kv[1]["ex_date"]):
            out[ticker].append(row)
        data = {"at": time.time(), "dividends": dict(out), "history": history}
        try:
            _CORP_FILE.parent.mkdir(parents=True, exist_ok=True)
            _CORP_FILE.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            pass
        return data

    def benchmark_yearly(self, symbol: str = "SPY") -> dict[str, float]:
        """Calendar-year total return of a fund, %, dividends reinvested: daily closes from the broker, each
        dividend added on the first trading day on or after its ex-date (the broker's candle dates can fall a
        day or two off). Only years the broker's dividend history fully covers; the current year is to date."""
        sym = symbol.upper()
        cache = self._corp_cache()
        divs = sorted(((cache or {}).get("history", {}).get(sym) or {}).items())
        if not divs:
            return {}
        end = date.today()
        raw = self._cached(
            f"candles:{sym}",
            lambda: self._c.candles(f"{sym}.US", (end - timedelta(days=3700)).strftime("%d.%m.%Y 00:00"), end.strftime("%d.%m.%Y 23:59")),
            ttl=6 * 60 * 60,
        )
        xs = ((raw or {}).get("xSeries") or {}).get(f"{sym}.US") or []
        hl = ((raw or {}).get("hloc") or {}).get(f"{sym}.US") or []
        closes = [
            (datetime.fromtimestamp(x, tz=timezone.utc).date().isoformat(), _f(v[3]))
            for x, v in zip(xs, hl)
            if isinstance(v, list) and len(v) > 3 and _f(v[3]) > 0
        ]
        pending = list(divs)
        index, prev, year_end = 1.0, None, {}
        for d, close in closes:
            div = 0.0
            while pending and pending[0][0] <= d:
                _, amount = pending.pop(0)
                if prev is not None:  # before the first close there is nothing to reinvest into
                    div += amount
            if prev is not None:
                index *= (close + div) / prev
            year_end[int(d[:4])] = index
            prev = close
        first = date.fromisoformat(divs[0][0])
        first_full_year = first.year if first.month <= 3 else first.year + 1
        return {
            str(y): round((year_end[y] / year_end[y - 1] - 1) * 100, 2)
            for y in sorted(year_end)
            if y - 1 in year_end and y >= first_full_year
        }

    # ---- Live prices ----

    def quotes(self, tickers: list[str]) -> dict[str, dict]:
        """Real-time last price and day change (vs yesterday's close) for app tickers, in the shape of the Yahoo
        rows the app used before. Tickers the broker doesn't know (crypto, other markets) are simply absent."""
        symbols = {t: (t if "." in t else f"{t}.US") for t in tickers if t and "-" not in t and "=" not in t}
        if not symbols:
            return {}
        key = ",".join(sorted(symbols.values()))
        data = self._cached(f"quotes:{key}", lambda: self._c.quotes(list(symbols.values())), ttl=_QUOTE_TTL)
        by_symbol = {str(q.get("c") or ""): q for q in ((data or {}).get("result") or {}).get("q") or [] if isinstance(q, dict)}
        out: dict[str, dict] = {}
        for ticker, symbol in symbols.items():
            q = by_symbol.get(symbol)
            price = _f(q.get("ltp")) if q else 0.0
            if price <= 0:
                continue
            out[ticker] = {
                "regularMarketPrice": price,
                "regularMarketChangePercent": _f(q.get("pcp")),
                "fiftyTwoWeekHigh": _f(q.get("x_max")) or None,
                "fiftyTwoWeekLow": _f(q.get("x_min")) or None,
                "marketStatus": str(q.get("marketStatus") or ""),
            }
        return out

    # ---- Dividends and cash (Finance → broker) ----

    def dividends(self) -> list[dict]:
        """One row per payment (date + ticker): gross amount and withheld tax (incl. the agent's fee), reversals
        netted out. A tax charged days after its payment is attached to that stock's latest payment."""
        def ticker_of(r: dict) -> str:
            m = _TICKER_IN_COMMENT.search(str(r.get("comment") or ""))
            return plain_ticker(m.group(1) or m.group(2)) if m else ""

        rows_io = sorted(self._in_outs(), key=lambda r: str(r.get("date")))
        groups: dict[tuple[str, str, str], dict[str, float]] = {}
        for r in rows_io:
            if str(r.get("type_id")).startswith("dividend"):
                key = (str(r.get("date"))[:10], ticker_of(r), _norm_ccy(r.get("currency")))
                groups.setdefault(key, {"amount": 0.0, "tax": 0.0})["amount"] += _f(r.get("amount"))
        for r in rows_io:
            if r.get("type_id") not in ("tax", "tax_reverted", "agent_fee"):
                continue
            iso, ticker, cur = str(r.get("date"))[:10], ticker_of(r), _norm_ccy(r.get("currency"))
            candidates = [k for k in groups if k[1] == ticker and k[2] == cur and 0 <= _days_between(iso, k[0]) <= 60]
            key = max(candidates) if candidates else (iso, ticker, cur)
            groups.setdefault(key, {"amount": 0.0, "tax": 0.0})["tax"] -= _f(r.get("amount"))  # withheld amounts are negative
        rows = [
            {
                "id": f"f24-div-{iso}-{ticker}",
                "date": _ddmmyyyy(iso),
                "ticker": ticker,
                "amount": f"{v['amount']:.2f}",
                "tax": f"{v['tax']:.2f}",
                "currency": cur,
            }
            for (iso, ticker, cur), v in groups.items()
            if abs(v["amount"]) >= 0.005 or abs(v["tax"]) >= 0.005
        ]
        rows.sort(key=lambda r: (r["date"][6:], r["date"][3:5], r["date"][:2]), reverse=True)
        return rows

    def cash(self) -> list[dict]:
        out = []
        for a in self._portfolio().get("acc") or []:
            amount = _f(a.get("s"))
            if abs(amount) < 0.005:
                continue
            cur = str(a.get("curr") or "USD").upper()
            cur = "RUB" if cur == "RUR" else cur
            out.append({"id": f"f24-cash-{cur}", "currency": cur, "amount": f"{amount:.2f}"})
        return out

    # ---- Positions (Portfolio) ----

    def holdings(self, saved: list[dict]) -> list[dict]:
        """Positions with the broker's numbers; your target, industry, name and trend from the saved rows."""
        mine = {str(h.get("ticker", "")).strip().upper(): h for h in saved if isinstance(h, dict)}
        positions = [p for p in self._portfolio().get("pos") or [] if p.get("i") and _f(p.get("q"))]
        total = sum(_f(p.get("market_value")) for p in positions) or 1.0
        rows = []
        for p in positions:
            ticker = plain_ticker(p["i"])
            h = mine.get(ticker, {})
            value = _f(p.get("market_value"))
            rows.append(
                {
                    "id": str(h.get("id") or f"f24-{ticker}"),
                    "ticker": ticker,
                    "name": str(h.get("name") or p.get("name") or ticker),
                    "industry": str(h.get("industry") or "—"),
                    "targetWeight": str(h.get("targetWeight") or "0.0%"),
                    "currentWeight": f"{value / total * 100:.1f}%",
                    "shares": _f(p.get("q")),
                    "avgBuyPrice": _money(_f(p.get("bal_price_a"))),
                    "marketPrice": _money(_f(p.get("mkt_price"))),
                    "marketValue": _money(value),
                    "pnl": _money(_f(p.get("profit_close"))),
                    "trend": str(h.get("trend") or ""),
                }
            )
        return rows
