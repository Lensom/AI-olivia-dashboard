"""Watchlist market data: a Finviz snapshot per ticker (performance, valuation, 52-week range),
a Yahoo price history for the trend chart and Yahoo headlines. Read-only; the list itself is the
user's picking rows (/investing/picking)."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from html import unescape
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import json
import re
import time
import xml.etree.ElementTree as ET

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.auth.router import get_current_user
from app.auth.schemas import UserResponse
from app.investing.router import _BROWSER_UA

router = APIRouter(prefix="/investing/watchlist", tags=["investing"])

_SNAPSHOT_TTL = 15 * 60
_SNAPSHOT_FAILURE_TTL = 2 * 60
_CHART_TTL = 10 * 60
_NEWS_TTL = 15 * 60
_WORKERS = 10

# Dip Finder periods → Finviz snapshot label.
PERF_LABELS = {
    "1W": "Perf Week",
    "1M": "Perf Month",
    "3M": "Perf Quarter",
    "6M": "Perf Half Y",
    "YTD": "Perf YTD",
    "1Y": "Perf Year",
    "3Y": "Perf 3Y",
    "5Y": "Perf 5Y",
}

# Range → (Yahoo range, interval).
CHART_RANGES = {"1M": ("1mo", "1d"), "6M": ("6mo", "1d"), "1Y": ("1y", "1d"), "5Y": ("5y", "1wk")}


class WatchlistSnapshot(BaseModel):
    name: str = ""
    exchange: str = ""
    is_fund: bool = False
    sector: str = ""
    price: float | None = None
    change_pct: float | None = None  # today, %
    market_cap: str = ""  # Finviz text, e.g. "5024.92B" (AUM for funds)
    pe: float | None = None
    forward_pe: float | None = None
    ev_ebitda: float | None = None
    recom: float | None = None  # analysts' mean, 1 = strong buy … 5 = sell
    target_price: float | None = None
    sales_growth: float | None = None  # %, Y/Y TTM
    expense: float | None = None  # %, funds
    div_yield: float | None = None  # %
    high_52w: float | None = None
    low_52w: float | None = None
    perf: dict[str, float] = Field(default_factory=dict)
    earnings: str = ""  # Finviz text, e.g. "Nov 02 AMC" (no year); used by app/investing/events.py
    dividend_ex_date: str = ""  # Finviz text, e.g. "Aug 10, 2026": the latest announced ex-dividend date
    dividend_est: float | None = None  # expected dividend per share over the next year


class WatchlistSnapshotsResponse(BaseModel):
    snapshots: dict[str, WatchlistSnapshot] = Field(default_factory=dict)


class WatchlistChartResponse(BaseModel):
    ticker: str
    range: str
    points: list[tuple[int, float]] = Field(default_factory=list)  # (unix seconds, close)


class WatchlistNewsItem(BaseModel):
    title: str
    link: str
    published: str | None = None  # ISO
    summary: str = ""


class WatchlistNewsResponse(BaseModel):
    ticker: str
    items: list[WatchlistNewsItem] = Field(default_factory=list)


_snapshot_cache: dict[str, tuple[WatchlistSnapshot | None, float]] = {}
_chart_cache: dict[tuple[str, str], tuple[WatchlistChartResponse, float]] = {}
_news_cache: dict[str, tuple[WatchlistNewsResponse, float]] = {}


def _cell(html: str, label: str) -> str:
    """Text of a Finviz snapshot value by its visible label ("Market Cap", "Perf YTD", "Recom")."""
    m = re.search(
        rf'snapshot-td-label">(?:<a[^>]*>)?{re.escape(label)}(?:</a>)?</div>.*?<b>(.*?)</b>',
        html,
        re.S,
    )
    return unescape(re.sub(r"<[^>]+>", " ", m.group(1))).strip() if m else ""


def _num(text: str) -> float | None:
    m = re.match(r"\s*([-+]?\d+(?:\.\d+)?)", text.replace(",", ""))
    return float(m.group(1)) if m else None


def _fetch_snapshot(ticker: str) -> WatchlistSnapshot | None:
    now = time.time()
    cached = _snapshot_cache.get(ticker)
    if cached and now - cached[1] < (_SNAPSHOT_TTL if cached[0] else _SNAPSHOT_FAILURE_TTL):
        return cached[0]
    url = f"https://finviz.com/quote.ashx?t={quote(ticker)}&p=d"
    req = Request(url, headers={"User-Agent": _BROWSER_UA, "Accept": "text/html,application/xhtml+xml,*/*"})
    try:
        with urlopen(req, timeout=8) as response:
            html = response.read().decode("utf-8", "ignore")
    except (HTTPError, URLError, TimeoutError):
        _snapshot_cache[ticker] = (None, now)
        return None

    title = re.search(r"<title>\s*[^<]*?\s-\s(.*?)\s+Stock Price and Quote\s*</title>", html, re.S)
    exchange = re.search(rf"google\.com/finance/quote/{re.escape(ticker)}:([A-Z]+)", html)
    is_fund = 'snapshot-td-label">Asset Type<' in html
    if is_fund:
        sector = _cell(html, "Category")
    else:
        m = re.search(r'href="screener\?v=111&(?:amp;)?f=sec_[^"]*"[^>]*>([^<]+)</a>', html)
        sector = unescape(m.group(1).strip()) if m else ""
    div = re.search(r"\(([-+]?\d+(?:\.\d+)?)%\)", _cell(html, "Dividend TTM"))

    snap = WatchlistSnapshot(
        name=unescape(title.group(1).strip()) if title else "",
        exchange=exchange.group(1) if exchange else "",
        is_fund=is_fund,
        sector=sector if sector != "-" else "",
        price=_num(_cell(html, "Price")),
        change_pct=_num(_cell(html, "Change %")),
        market_cap=(_cell(html, "AUM") if is_fund else "") or _cell(html, "Market Cap").replace("-", ""),
        pe=_num(_cell(html, "P/E")),
        forward_pe=_num(_cell(html, "Forward P/E")),
        ev_ebitda=_num(_cell(html, "EV/EBITDA")),
        recom=_num(_cell(html, "Recom")),
        target_price=_num(_cell(html, "Target Price")),
        sales_growth=_num(_cell(html, "Sales Y/Y TTM")),
        expense=_num(_cell(html, "Expense")),
        div_yield=float(div.group(1)) if div else None,
        high_52w=_num(_cell(html, "52W High")),
        low_52w=_num(_cell(html, "52W Low")),
        perf={k: v for k, label in PERF_LABELS.items() if (v := _num(_cell(html, label))) is not None},
        earnings=_cell(html, "Earnings").replace("-", "").strip(),
        dividend_ex_date=_cell(html, "Dividend Ex-Date").replace("-", "").strip(),
        dividend_est=_num(_cell(html, "Dividend Est.")),
    )
    if not (snap.name or snap.perf):
        snap = None
    _snapshot_cache[ticker] = (snap, now)
    return snap


@router.get("/snapshots", response_model=WatchlistSnapshotsResponse)
def get_snapshots(
    tickers: Annotated[str, Query(description="Comma-separated tickers, e.g. AAPL,SMH")] = "",
    user: Annotated[UserResponse, Depends(get_current_user)] = None,
):
    """Per-ticker performance (1W … 5Y), valuation and 52-week range from Finviz; unknown tickers are omitted."""
    _ = user.id
    unique = list(dict.fromkeys(t.strip().upper() for t in tickers.split(",") if t.strip()))[:50]
    with ThreadPoolExecutor(max_workers=_WORKERS) as pool:
        results = list(pool.map(_fetch_snapshot, unique))
    return WatchlistSnapshotsResponse(snapshots={t: s for t, s in zip(unique, results) if s})


@router.get("/chart", response_model=WatchlistChartResponse)
def get_chart(
    ticker: Annotated[str, Query(min_length=1, max_length=20)],
    range: Annotated[str, Query(pattern="^(1M|6M|1Y|5Y)$")] = "1M",
    user: Annotated[UserResponse, Depends(get_current_user)] = None,
):
    """Closing prices for the trend chart (Yahoo)."""
    _ = user.id
    sym = ticker.strip().upper()
    now = time.time()
    cached = _chart_cache.get((sym, range))
    if cached and now - cached[1] < _CHART_TTL:
        return cached[0]
    yrange, interval = CHART_RANGES[range]
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{quote(sym)}?range={yrange}&interval={interval}"
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))["chart"]["result"][0]
        stamps = result.get("timestamp") or []
        closes = result["indicators"]["quote"][0]["close"]
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError, TypeError):
        return WatchlistChartResponse(ticker=sym, range=range)
    points = [(int(ts), round(float(c), 4)) for ts, c in zip(stamps, closes) if isinstance(c, (int, float))]
    res = WatchlistChartResponse(ticker=sym, range=range, points=points)
    if points:
        _chart_cache[(sym, range)] = (res, now)
    return res


@router.get("/news", response_model=WatchlistNewsResponse)
def get_news(
    ticker: Annotated[str, Query(min_length=1, max_length=20)],
    user: Annotated[UserResponse, Depends(get_current_user)] = None,
):
    """Latest headlines for a ticker (Yahoo Finance RSS)."""
    _ = user.id
    sym = ticker.strip().upper()
    now = time.time()
    cached = _news_cache.get(sym)
    if cached and now - cached[1] < _NEWS_TTL:
        return cached[0]
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={quote(sym)}&region=US&lang=en-US"
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urlopen(req, timeout=8) as response:
            root = ET.fromstring(response.read())
    except (HTTPError, URLError, TimeoutError, ET.ParseError):
        return WatchlistNewsResponse(ticker=sym)
    items: list[WatchlistNewsItem] = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        link = (it.findtext("link") or "").strip()
        if not title or not link.startswith("http"):
            continue
        published = None
        try:
            published = parsedate_to_datetime(it.findtext("pubDate") or "").isoformat()
        except (TypeError, ValueError):
            pass
        items.append(
            WatchlistNewsItem(title=title, link=link, published=published, summary=(it.findtext("description") or "").strip())
        )
    items.sort(key=lambda i: i.published or "", reverse=True)
    res = WatchlistNewsResponse(ticker=sym, items=items[:12])
    _news_cache[sym] = (res, now)
    return res
