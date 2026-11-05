"""One stock's page: company profile, key statistics, analyst estimates, reported financials and
insider trades (Yahoo Finance), with the Finviz snapshot filling what Yahoo doesn't have. Read-only.

Yahoo's quoteSummary needs a session cookie and a "crumb"; the fundamentals time series doesn't, and
gives about 5 quarters and 4 years. A failed source only empties its own part of the response."""

from __future__ import annotations

import json
import math
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from typing import Annotated, Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import OpenerDirector, HTTPCookieProcessor, Request, build_opener

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from app.auth.router import get_current_user
from app.auth.schemas import UserResponse
from app.investing.router import _BROWSER_UA
from app.investing.watchlist import WatchlistSnapshot, _fetch_snapshot

router = APIRouter(prefix="/investing/stock", tags=["investing"])

TICKER_PATH = Path(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-^=]+$")

_DETAIL_TTL = 10 * 60  # prices are part of it
_FINANCIALS_TTL = 6 * 60 * 60  # only changes when a company reports
_FAILURE_TTL = 2 * 60
_INSIDER_WINDOW_S = 365 * 86400

_SUMMARY_MODULES = "price,assetProfile,financialData,defaultKeyStatistics,summaryDetail,calendarEvents,earningsTrend,insiderTransactions,topHoldings"

# Series name in Yahoo (after the quarterly/annual prefix) → field of Financials.
_SERIES = {
    "TotalRevenue": "revenue",
    "NetIncome": "net_income",
    "FreeCashFlow": "fcf",
    "DilutedEPS": "eps",
    "CashCashEquivalentsAndShortTermInvestments": "cash",
    "TotalDebt": "debt",
    "DilutedAverageShares": "shares",
    "StockBasedCompensation": "sbc",
}


class Point(BaseModel):
    period: str  # the period's last day, YYYY-MM-DD
    value: float


class Financials(BaseModel):
    revenue: list[Point] = Field(default_factory=list)
    net_income: list[Point] = Field(default_factory=list)
    fcf: list[Point] = Field(default_factory=list)
    eps: list[Point] = Field(default_factory=list)
    cash: list[Point] = Field(default_factory=list)
    debt: list[Point] = Field(default_factory=list)
    shares: list[Point] = Field(default_factory=list)
    sbc: list[Point] = Field(default_factory=list)


class Profile(BaseModel):
    summary: str = ""
    sector: str = ""
    industry: str = ""
    country: str = ""
    website: str = ""
    employees: int | None = None
    ceo: str = ""


class Stats(BaseModel):
    """Percent fields are in percent (12.3 = 12.3%); money is in the currency it's quoted or reported in."""

    market_cap: float | None = None  # net assets for funds
    pe: float | None = None
    forward_pe: float | None = None
    peg: float | None = None
    price_to_sales: float | None = None
    price_to_book: float | None = None
    ev_ebitda: float | None = None
    fcf_ttm: float | None = None
    sbc_ttm: float | None = None
    fcf_yield: float | None = None
    fcf_yield_after_sbc: float | None = None
    gross_margin: float | None = None
    operating_margin: float | None = None
    profit_margin: float | None = None
    revenue_growth: float | None = None
    earnings_growth: float | None = None
    return_on_equity: float | None = None
    cash: float | None = None
    debt: float | None = None
    net_cash: float | None = None
    div_yield: float | None = None
    payout_ratio: float | None = None
    expense_ratio: float | None = None
    beta: float | None = None
    high_52w: float | None = None
    low_52w: float | None = None
    ma_50: float | None = None
    ma_200: float | None = None
    target_mean: float | None = None
    target_low: float | None = None
    target_high: float | None = None
    recommendation: float | None = None  # 1 = strong buy … 5 = sell
    analysts: int | None = None


class Estimate(BaseModel):
    """Yahoo's period dates here are unreliable, so periods are only named relative to today."""

    period: str  # "0q" current quarter, "+1q" next quarter, "0y" current year, "+1y" next year
    eps_avg: float | None = None
    eps_low: float | None = None
    eps_high: float | None = None
    eps_analysts: int | None = None
    revenue_avg: float | None = None
    revenue_low: float | None = None
    revenue_high: float | None = None
    revenue_analysts: int | None = None
    eps_growth: float | None = None  # %, vs the same period a year earlier


class InsiderTrade(BaseModel):
    date: str  # YYYY-MM-DD
    name: str
    relation: str = ""
    kind: str  # "buy" | "sell"
    shares: float | None = None
    value: float | None = None


class FundHolding(BaseModel):
    symbol: str
    name: str = ""
    weight: float  # % of the fund


class StockDetail(BaseModel):
    ticker: str
    name: str = ""
    exchange: str = ""
    is_fund: bool = False
    currency: str = "USD"
    financial_currency: str = "USD"  # may differ from the quote's, e.g. foreign ADRs
    price: float | None = None
    change: float | None = None
    change_pct: float | None = None
    earnings_date: str | None = None  # YYYY-MM-DD
    earnings_date_estimated: bool = False
    ex_dividend_date: str | None = None
    profile: Profile = Field(default_factory=Profile)
    stats: Stats = Field(default_factory=Stats)
    estimates: list[Estimate] = Field(default_factory=list)
    quarterly: Financials = Field(default_factory=Financials)
    annual: Financials = Field(default_factory=Financials)
    insiders: list[InsiderTrade] = Field(default_factory=list)
    fund_holdings: list[FundHolding] = Field(default_factory=list)  # a fund's largest positions, usually 10


# ---- Reading Yahoo's {"raw": 1.2, "fmt": "1.2%"} values ----


def _raw(node: Any) -> float | None:
    value = node.get("raw") if isinstance(node, dict) else node
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def _int(node: Any) -> int | None:
    value = _raw(node)
    return int(value) if value is not None else None


def _percent(node: Any) -> float | None:
    """Percent as displayed: Yahoo's raw scale for the same field has changed over time, its "fmt" hasn't."""
    text = node.get("fmt") if isinstance(node, dict) else None
    match = re.fullmatch(r"\s*(-?[\d,.]+)%\s*", text or "")
    return float(match.group(1).replace(",", "")) if match else None


def _day(node: Any) -> str | None:
    stamp = _raw(node)
    return datetime.fromtimestamp(stamp, timezone.utc).strftime("%Y-%m-%d") if stamp else None


# ---- Fetching ----


class _YahooSession:
    """The cookie and crumb quoteSummary wants, shared between requests and renewed when rejected."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._opener: OpenerDirector | None = None
        self._crumb = ""

    def _open(self, opener: OpenerDirector, url: str) -> bytes:
        with opener.open(Request(url, headers={"User-Agent": _BROWSER_UA}), timeout=10) as response:
            return response.read()

    def _login(self) -> tuple[OpenerDirector, str]:
        with self._lock:
            if self._opener is None or not self._crumb:
                opener = build_opener(HTTPCookieProcessor(CookieJar()))
                try:
                    self._open(opener, "https://fc.yahoo.com")
                except HTTPError:
                    pass  # it answers 404, and sets the cookie anyway
                self._crumb = self._open(opener, "https://query1.finance.yahoo.com/v1/test/getcrumb").decode("utf-8").strip()
                self._opener = opener
            return self._opener, self._crumb

    def _reset(self) -> None:
        with self._lock:
            self._opener, self._crumb = None, ""

    def summary(self, ticker: str) -> dict[str, Any] | None:
        for attempt in range(2):
            try:
                opener, crumb = self._login()
                url = (
                    f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{quote(ticker)}"
                    f"?modules={_SUMMARY_MODULES}&crumb={quote(crumb)}"
                )
                result = json.loads(self._open(opener, url).decode("utf-8"))["quoteSummary"]["result"]
                return result[0] if result else None
            except HTTPError as exc:
                if exc.code not in (401, 403) or attempt:
                    return None
                self._reset()
            except (URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError, TypeError):
                return None
        return None


_session = _YahooSession()
_detail_cache: dict[str, tuple[StockDetail | None, float]] = {}
_financials_cache: dict[str, tuple[tuple[Financials, Financials] | None, float]] = {}


def _parse_financials(results: list[dict[str, Any]]) -> tuple[Financials, Financials]:
    quarterly, annual = Financials(), Financials()
    for result in results:
        kind = ((result.get("meta") or {}).get("type") or [""])[0]
        for prefix, target in (("quarterly", quarterly), ("annual", annual)):
            field = _SERIES.get(kind.removeprefix(prefix)) if kind.startswith(prefix) else None
            if not field:
                continue
            points = [
                Point(period=item["asOfDate"], value=value)
                for item in result.get(kind) or []
                if isinstance(item, dict) and item.get("asOfDate") and (value := _raw(item.get("reportedValue"))) is not None
            ]
            setattr(target, field, sorted(points, key=lambda p: p.period))
    return quarterly, annual


def _fetch_financials(ticker: str) -> tuple[Financials, Financials] | None:
    now = time.time()
    cached = _financials_cache.get(ticker)
    if cached and now - cached[1] < (_FINANCIALS_TTL if cached[0] else _FAILURE_TTL):
        return cached[0]
    types = ",".join(f"{prefix}{name}" for prefix in ("quarterly", "annual") for name in _SERIES)
    url = (
        f"https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{quote(ticker)}"
        f"?symbol={quote(ticker)}&type={types}&period1={int(now - 6 * 365 * 86400)}&period2={int(now)}"
    )
    try:
        with build_opener().open(Request(url, headers={"User-Agent": _BROWSER_UA}), timeout=10) as response:
            data = json.loads(response.read().decode("utf-8"))
        parsed = _parse_financials(data["timeseries"]["result"] or [])
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError, TypeError):
        parsed = None
    _financials_cache[ticker] = (parsed, now)
    return parsed


def _parse_estimates(summary: dict[str, Any]) -> list[Estimate]:
    rows: list[Estimate] = []
    for item in (summary.get("earningsTrend") or {}).get("trend") or []:
        eps, revenue = item.get("earningsEstimate") or {}, item.get("revenueEstimate") or {}
        if item.get("period") not in ("0q", "+1q", "0y", "+1y") or _raw(eps.get("avg")) is None and _raw(revenue.get("avg")) is None:
            continue
        rows.append(
            Estimate(
                period=item["period"],
                eps_avg=_raw(eps.get("avg")),
                eps_low=_raw(eps.get("low")),
                eps_high=_raw(eps.get("high")),
                eps_analysts=_int(eps.get("numberOfAnalysts")),
                revenue_avg=_raw(revenue.get("avg")),
                revenue_low=_raw(revenue.get("low")),
                revenue_high=_raw(revenue.get("high")),
                revenue_analysts=_int(revenue.get("numberOfAnalysts")),
                eps_growth=_percent(eps.get("growth")),
            )
        )
    return rows


def _parse_insiders(summary: dict[str, Any], now: float) -> list[InsiderTrade]:
    """Open-market purchases and sales from the last year; gifts and grants say nothing about conviction."""
    trades: list[InsiderTrade] = []
    for item in (summary.get("insiderTransactions") or {}).get("transactions") or []:
        text = str(item.get("transactionText") or "").strip().lower()
        kind = "sell" if text.startswith("sale") else "buy" if text.startswith("purchase") else None
        stamp = _raw(item.get("startDate"))
        if not kind or not stamp or now - stamp > _INSIDER_WINDOW_S:
            continue
        trades.append(
            InsiderTrade(
                date=_day(item.get("startDate")) or "",
                name=str(item.get("filerName") or "").strip().title(),
                relation=str(item.get("filerRelation") or "").strip(),
                kind=kind,
                shares=_raw(item.get("shares")),
                value=_raw(item.get("value")),
            )
        )
    return sorted(trades, key=lambda t: t.date, reverse=True)


def _parse_fund_holdings(summary: dict[str, Any]) -> list[FundHolding]:
    rows: list[FundHolding] = []
    for item in (summary.get("topHoldings") or {}).get("holdings") or []:
        symbol = str(item.get("symbol") or "").strip().upper()
        weight = _percent(item.get("holdingPercent"))
        if symbol and weight is not None:
            rows.append(FundHolding(symbol=symbol, name=str(item.get("holdingName") or ""), weight=weight))
    return rows


def _ceo(officers: list[dict[str, Any]]) -> str:
    for officer in officers:
        title = str(officer.get("title") or "")
        if re.search(r"\bCEO\b|chief executive", title, re.I):
            return re.sub(r"^(Mr|Ms|Mrs|Dr)\.?\s+", "", re.sub(r"\s+", " ", str(officer.get("name") or "")).strip())
    return ""


def _sum_last_year(points: list[Point]) -> float | None:
    """Trailing twelve months: the last four quarters, only when all four are there."""
    return sum(p.value for p in points[-4:]) if len(points) >= 4 else None


def build_detail(
    ticker: str,
    summary: dict[str, Any] | None,
    financials: tuple[Financials, Financials] | None,
    snapshot: WatchlistSnapshot | None,
    now: float,
) -> StockDetail | None:
    """Combine the sources; None when none of them knows the ticker."""
    if not summary and not snapshot and not financials:
        return None
    summary = summary or {}
    quote_ = summary.get("price") or {}
    asset = summary.get("assetProfile") or {}
    fin = summary.get("financialData") or {}
    keys = summary.get("defaultKeyStatistics") or {}
    det = summary.get("summaryDetail") or {}
    earnings = (summary.get("calendarEvents") or {}).get("earnings") or {}
    quarterly, annual = financials or (Financials(), Financials())
    snap = snapshot or WatchlistSnapshot()

    is_fund = str(quote_.get("quoteType") or "").upper() in ("ETF", "MUTUALFUND") or snap.is_fund
    currency = str(quote_.get("currency") or det.get("currency") or "USD").upper()
    financial_currency = str(fin.get("financialCurrency") or currency).upper()

    price = _raw(quote_.get("regularMarketPrice"))
    if price is None:
        price = snap.price
    change_pct = _percent(quote_.get("regularMarketChangePercent"))
    if change_pct is None:
        change_pct = snap.change_pct

    market_cap = _raw(det.get("marketCap"))
    if market_cap is None:
        market_cap = _raw(det.get("totalAssets")) or _raw(keys.get("totalAssets"))
    cash, debt = _raw(fin.get("totalCash")), _raw(fin.get("totalDebt"))
    fcf_ttm, sbc_ttm = _sum_last_year(quarterly.fcf), _sum_last_year(quarterly.sbc)
    # A yield means nothing across currencies (e.g. an ADR quoted in USD reporting in TWD).
    comparable = market_cap and currency == financial_currency

    stats = Stats(
        market_cap=market_cap,
        pe=_raw(det.get("trailingPE")) or snap.pe,
        forward_pe=_raw(det.get("forwardPE")) or _raw(keys.get("forwardPE")) or snap.forward_pe,
        peg=_raw(keys.get("pegRatio")),
        price_to_sales=_raw(det.get("priceToSalesTrailing12Months")),
        price_to_book=_raw(keys.get("priceToBook")),
        ev_ebitda=_raw(keys.get("enterpriseToEbitda")) or snap.ev_ebitda,
        fcf_ttm=fcf_ttm,
        sbc_ttm=sbc_ttm,
        fcf_yield=fcf_ttm / market_cap * 100 if comparable and fcf_ttm is not None else None,
        fcf_yield_after_sbc=(fcf_ttm - sbc_ttm) / market_cap * 100 if comparable and fcf_ttm is not None and sbc_ttm is not None else None,
        gross_margin=_percent(fin.get("grossMargins")),
        operating_margin=_percent(fin.get("operatingMargins")),
        profit_margin=_percent(fin.get("profitMargins")),
        revenue_growth=_percent(fin.get("revenueGrowth")),
        earnings_growth=_percent(fin.get("earningsGrowth")),
        return_on_equity=_percent(fin.get("returnOnEquity")),
        cash=cash,
        debt=debt,
        net_cash=cash - debt if cash is not None and debt is not None else None,
        div_yield=next((v for v in (_percent(det.get("dividendYield")), _percent(det.get("yield")), snap.div_yield) if v is not None), None),
        payout_ratio=_percent(det.get("payoutRatio")),
        expense_ratio=snap.expense,
        beta=_raw(det.get("beta")) or _raw(keys.get("beta")) or _raw(keys.get("beta3Year")),
        high_52w=_raw(det.get("fiftyTwoWeekHigh")) or snap.high_52w,
        low_52w=_raw(det.get("fiftyTwoWeekLow")) or snap.low_52w,
        ma_50=_raw(det.get("fiftyDayAverage")),
        ma_200=_raw(det.get("twoHundredDayAverage")),
        target_mean=_raw(fin.get("targetMeanPrice")) or snap.target_price,
        target_low=_raw(fin.get("targetLowPrice")),
        target_high=_raw(fin.get("targetHighPrice")),
        recommendation=_raw(fin.get("recommendationMean")) or snap.recom,
        analysts=_int(fin.get("numberOfAnalystOpinions")),
    )

    website = str(asset.get("website") or "")
    earnings_dates = earnings.get("earningsDate") or []
    return StockDetail(
        ticker=ticker,
        name=str(quote_.get("longName") or quote_.get("shortName") or snap.name or ""),
        exchange=str(quote_.get("exchangeName") or snap.exchange or ""),
        is_fund=is_fund,
        currency=currency,
        financial_currency=financial_currency,
        price=price,
        change=_raw(quote_.get("regularMarketChange")),
        change_pct=change_pct,
        earnings_date=_day(earnings_dates[0]) if earnings_dates else None,
        earnings_date_estimated=bool(earnings.get("isEarningsDateEstimate")),
        ex_dividend_date=_day(det.get("exDividendDate")),
        profile=Profile(
            summary=str(asset.get("longBusinessSummary") or ""),
            sector=str(asset.get("sector") or snap.sector or ""),
            industry=str(asset.get("industry") or ""),
            country=str(asset.get("country") or ""),
            website=website if website.startswith("http") else "",
            employees=_int(asset.get("fullTimeEmployees")),
            ceo=_ceo(asset.get("companyOfficers") or []),
        ),
        stats=stats,
        estimates=_parse_estimates(summary),
        quarterly=quarterly,
        annual=annual,
        insiders=_parse_insiders(summary, now),
        fund_holdings=_parse_fund_holdings(summary),
    )


def fetch_detail(ticker: str) -> StockDetail | None:
    now = time.time()
    cached = _detail_cache.get(ticker)
    if cached and now - cached[1] < (_DETAIL_TTL if cached[0] else _FAILURE_TTL):
        return cached[0]
    with ThreadPoolExecutor(max_workers=3) as pool:
        summary = pool.submit(_session.summary, ticker)
        financials = pool.submit(_fetch_financials, ticker)
        snapshot = pool.submit(_fetch_snapshot, ticker)
        detail = build_detail(ticker, summary.result(), financials.result(), snapshot.result(), now)
    _detail_cache[ticker] = (detail, now)
    return detail


@router.get("/{ticker}", response_model=StockDetail)
def get_stock(
    ticker: Annotated[str, TICKER_PATH],
    user: Annotated[UserResponse, Depends(get_current_user)],
):
    _ = user.id
    sym = ticker.strip().upper()
    detail = fetch_detail(sym)
    if detail is None:
        raise HTTPException(status_code=404, detail=f"No market data found for {sym}")
    return detail
