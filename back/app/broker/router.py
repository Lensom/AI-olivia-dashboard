"""Freedom24 (read-only) endpoints. Only the owner of the API keys may use them."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.router import get_current_user
from app.auth.schemas import UserResponse
from app.broker.freedom24 import Freedom24Error, Freedom24ReadOnly
from app.investing.router import _QUOTE_WORKERS, _fetch_finviz_profile
from app.investing.schemas import InvestingHoldingImportRow, InvestingHoldingsImportResponse

router = APIRouter(prefix="/broker/freedom24", tags=["broker"])


@dataclass(frozen=True)
class Freedom24Settings:
    public_key: str = ""
    private_key: str = ""
    owner_email: str = ""


def get_freedom24_settings() -> Freedom24Settings:
    """Overridden in main.py with values from back/.env."""
    return Freedom24Settings()


def owner_client(
    user: Annotated[UserResponse, Depends(get_current_user)],
    cfg: Annotated[Freedom24Settings, Depends(get_freedom24_settings)],
) -> Freedom24ReadOnly:
    # The keys belong to one person; other accounts on this app must never see that portfolio.
    if not cfg.owner_email or user.email.lower() != cfg.owner_email.strip().lower():
        raise HTTPException(status_code=403, detail="Freedom24 is not connected for this account.")
    if not cfg.public_key or not cfg.private_key:
        raise HTTPException(status_code=503, detail="Add FREEDOM24_PUBLIC_KEY and FREEDOM24_PRIVATE_KEY to back/.env.")
    return Freedom24ReadOnly(cfg.public_key, cfg.private_key)


def source_for(user: UserResponse, cfg: Freedom24Settings):
    """The Freedom24 data source for the keys' owner, else None (their data stays in the database)."""
    from app.broker.sync import Freedom24Source  # sync imports the investing router; import late to avoid a cycle

    if not cfg.owner_email or user.email.lower() != cfg.owner_email.strip().lower():
        return None
    if not cfg.public_key or not cfg.private_key:
        return None
    return Freedom24Source(Freedom24ReadOnly(cfg.public_key, cfg.private_key))


class F24Position(BaseModel):
    ticker: str  # without the market suffix, to match the Portfolio ("AAPL")
    symbol: str  # as Freedom24 names it ("AAPL.US")
    name: str
    quantity: float
    avg_price: float | None  # average buy price
    market_price: float | None
    close_price: float | None  # previous close
    market_value: float | None
    profit: float | None  # unrealized P&L in the position's currency
    currency: str


class F24Cash(BaseModel):
    currency: str
    amount: float


class F24Preview(BaseModel):
    fetched_at: str
    positions: list[F24Position]
    cash: list[F24Cash]


def _num(v: Any) -> float | None:
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def _plain_ticker(symbol: str) -> str:
    # "AAPL.US" -> "AAPL"; keeps class shares like "BRK.B".
    return re.sub(r"\.[A-Z]{2,3}$", "", symbol.strip().upper())


class F24Status(BaseModel):
    connected: bool


@router.get("/status", response_model=F24Status)
def status(
    user: Annotated[UserResponse, Depends(get_current_user)],
    cfg: Annotated[Freedom24Settings, Depends(get_freedom24_settings)],
):
    """Whether this account may use Freedom24 (no call to the broker). The UI hides the sync otherwise."""
    is_owner = bool(cfg.owner_email) and user.email.lower() == cfg.owner_email.strip().lower()
    return F24Status(connected=is_owner and bool(cfg.public_key and cfg.private_key))


@router.get("/holdings", response_model=InvestingHoldingsImportResponse)
def holdings(client: Annotated[Freedom24ReadOnly, Depends(owner_client)]):
    """Positions as import rows, the same shape as POST /investing/holdings/import: the client merges
    them into the Portfolio (keeping targets, industries and names) as unsaved edits. Nothing is saved here."""
    data = preview(client)
    rows: list[InvestingHoldingImportRow] = []
    skipped: list[str] = []
    for p in data.positions:
        # The Portfolio is in USD; a position in another currency is listed instead of mixed in.
        if (p.currency and p.currency != "USD") or p.avg_price is None:
            skipped.append(f"{p.ticker} ({p.currency or '?'})")
            continue
        price = p.market_price or 0.0
        rows.append(
            InvestingHoldingImportRow(
                ticker=p.ticker,
                shares=p.quantity,
                avgBuyPrice=p.avg_price,
                marketPrice=price,
                marketValue=p.market_value if p.market_value is not None else price * p.quantity,
                name=p.name,
            )
        )
    # Industries for positions the Portfolio doesn't have yet (cached Finviz lookups, as for XLSX import).
    with ThreadPoolExecutor(max_workers=_QUOTE_WORKERS) as pool:
        profiles = list(pool.map(_fetch_finviz_profile, [r.ticker for r in rows]))
    for r, prof in zip(rows, profiles):
        if prof:
            r.industry = prof.industry
            r.name = r.name or prof.name
    return InvestingHoldingsImportResponse(rows=rows, skipped=skipped)


@router.get("/preview", response_model=F24Preview)
def preview(client: Annotated[Freedom24ReadOnly, Depends(owner_client)]):
    """Positions and cash as Freedom24 reports them right now (getPositionJson, read-only)."""
    try:
        data = client.portfolio()
    except Freedom24Error as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    ps = ((data or {}).get("result") or {}).get("ps") or {}
    positions = [
        F24Position(
            ticker=_plain_ticker(str(p.get("i") or "")),
            symbol=str(p.get("i") or ""),
            name=str(p.get("name") or p.get("name2") or ""),
            quantity=_num(p.get("q")) or 0.0,
            avg_price=_num(p.get("bal_price_a")),
            market_price=_num(p.get("mkt_price")),
            close_price=_num(p.get("close_price")),
            market_value=_num(p.get("market_value")),
            profit=_num(p.get("profit_close")),
            currency=str(p.get("curr") or ""),
        )
        for p in ps.get("pos") or []
        if p.get("i")
    ]
    cash = [F24Cash(currency=str(a.get("curr") or ""), amount=_num(a.get("s")) or 0.0) for a in ps.get("acc") or []]
    return F24Preview(fetched_at=datetime.now(timezone.utc).isoformat(), positions=positions, cash=cash)
