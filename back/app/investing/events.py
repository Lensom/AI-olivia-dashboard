"""Upcoming events per ticker for the Calendar page: the next earnings report and ex-dividend dates.

Earnings and the latest announced ex-dividend date come from the Finviz snapshot (app/investing/watchlist.py).
The dividend history (dates and amounts) comes from Yahoo's chart API. It gives how often a ticker pays and
how much, so the ex-dates of the next 12 months can be projected. Projected dates are flagged as estimates.
Read-only and cached."""

from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth.router import get_current_user
from app.auth.schemas import UserResponse
from app.investing.router import _BROWSER_UA
from app.investing.watchlist import _fetch_snapshot

router = APIRouter(prefix="/investing/events", tags=["investing"])

_TTL = 6 * 60 * 60
_WORKERS = 8
_HORIZON_DAYS = 365
# Payments a year → typical days between ex-dates.
_FREQUENCIES = {12: 30, 4: 91, 2: 182, 1: 365}


class DividendDate(BaseModel):
    date: str  # ISO
    amount: float | None = None  # per share, in the ticker's currency
    estimated: bool = False  # projected from the payment rhythm rather than announced


class TickerEvents(BaseModel):
    ticker: str
    earnings_date: str = ""  # ISO; empty when unknown (funds have none)
    earnings_time: str = ""  # "BMO" before market open, "AMC" after close
    earnings_estimated: bool = False  # the reported date has passed: the next one is ~a quarter later
    dividend_frequency: int | None = None  # payments a year
    dividend_amount: float | None = None  # latest dividend per share
    last_ex_date: str = ""  # ISO, the most recent ex-dividend date that has passed
    ex_dates: list[DividendDate] = Field(default_factory=list)  # from today, up to a year ahead
    history: list[DividendDate] = Field(default_factory=list)  # last payments, newest first


class EventsResponse(BaseModel):
    events: dict[str, TickerEvents] = Field(default_factory=dict)


_cache: dict[str, tuple[TickerEvents, float]] = {}


def _earnings(text: str, today: date) -> tuple[date | None, str]:
    """Finviz "Nov 02 AMC" has no year: take the year that puts the date closest to today."""
    m = re.match(r"([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(AMC|BMO))?", text.strip())
    if not m:
        return None, ""
    best: date | None = None
    for year in (today.year - 1, today.year, today.year + 1):
        try:
            d = datetime.strptime(f"{m.group(1)} {m.group(2)} {year}", "%b %d %Y").date()
        except ValueError:
            continue
        if best is None or abs((d - today).days) < abs((best - today).days):
            best = d
    return best, m.group(3) or ""


def _dividend_history(ticker: str) -> list[DividendDate]:
    """Ex-dividend dates and amounts of the last 3 years (Yahoo), newest first."""
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(ticker)}?range=3y&interval=1mo&events=div"
    try:
        with urlopen(Request(url, headers={"User-Agent": _BROWSER_UA}), timeout=8) as res:
            data = json.loads(res.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, ValueError):
        return []
    result = ((data.get("chart") or {}).get("result") or [None])[0] or {}
    divs = ((result.get("events") or {}).get("dividends") or {}).values()
    rows = [
        DividendDate(date=datetime.fromtimestamp(int(d["date"]), tz=timezone.utc).date().isoformat(), amount=round(float(d["amount"]), 4))
        for d in divs
        if d.get("date") and d.get("amount")
    ]
    return sorted(rows, key=lambda r: r.date, reverse=True)


def _frequency(history: list[DividendDate]) -> int | None:
    """Payments a year from the median gap between ex-dates, snapped to monthly / quarterly / semi-annual / annual."""
    if len(history) < 2:
        return 1 if history else None
    days = sorted(
        (date.fromisoformat(a.date) - date.fromisoformat(b.date)).days for a, b in zip(history, history[1:])
    )
    gap = days[len(days) // 2]
    return min(_FREQUENCIES, key=lambda f: abs(_FREQUENCIES[f] - gap))


def _events(ticker: str) -> TickerEvents:
    hit = _cache.get(ticker)
    if hit and time.time() - hit[1] < _TTL:
        return hit[0]
    today = date.today()
    snap = _fetch_snapshot(ticker)
    out = TickerEvents(ticker=ticker)

    if snap and snap.earnings:
        d, when = _earnings(snap.earnings, today)
        if d is not None:
            # Already reported: the next report is roughly a quarter later.
            estimated = d < today
            while d < today:
                d += timedelta(days=91)
            out.earnings_date, out.earnings_time, out.earnings_estimated = d.isoformat(), "" if estimated else when, estimated

    history = _dividend_history(ticker)
    announced = None
    if snap and snap.dividend_ex_date:
        try:
            announced = datetime.strptime(snap.dividend_ex_date, "%b %d, %Y").date()
        except ValueError:
            announced = None
    freq = _frequency(history)
    if history or announced:
        amount = history[0].amount if history else None
        if amount is None and snap and snap.dividend_est and freq:
            amount = round(snap.dividend_est / freq, 4)
        out.dividend_frequency, out.dividend_amount, out.history = freq, amount, history[:8]
        past = [date.fromisoformat(h.date) for h in history if date.fromisoformat(h.date) < today]
        if announced and announced < today:
            past.append(announced)
        out.last_ex_date = max(past).isoformat() if past else ""

        upcoming: list[DividendDate] = []
        if announced and announced >= today:
            upcoming.append(DividendDate(date=announced.isoformat(), amount=amount))
        if freq:
            step = timedelta(days=_FREQUENCIES[freq])
            anchor = max([d for d in [announced, *past] if d is not None], default=None)
            if anchor is not None:
                d = anchor + step
                while d <= today + timedelta(days=_HORIZON_DAYS):
                    if d >= today and not any(abs((date.fromisoformat(u.date) - d).days) < step.days / 2 for u in upcoming):
                        upcoming.append(DividendDate(date=d.isoformat(), amount=amount, estimated=True))
                    d += step
        out.ex_dates = sorted(upcoming, key=lambda u: u.date)

    _cache[ticker] = (out, time.time())
    return out


@router.get("", response_model=EventsResponse)
def get_events(
    user: Annotated[UserResponse, Depends(get_current_user)],
    tickers: str = Query(min_length=1, max_length=2000),
):
    """Events for up to 80 comma-separated tickers."""
    wanted = list(dict.fromkeys(t.strip().upper() for t in tickers.split(",") if t.strip()))[:80]
    with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
        return EventsResponse(events={e.ticker: e for e in pool.map(_events, wanted)})
