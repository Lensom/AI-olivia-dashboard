"""AI analysis with Gemini: one ticker, the whole portfolio, and the stock page's buy decision.

Ticker: everything you entered about it (buy zones, price goals, notes, position, trades) plus market
data (Finviz snapshot, Yahoo headlines). Portfolio: every holding at live prices, cash, deposits,
realized gains, dividends, target weights and the watchlist buy zones. Both return a structured,
validated answer; the latest of each is saved, so it's there when you come back."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from html import unescape
from typing import Annotated, Any, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.concurrency import run_in_threadpool
from google.genai import errors as genai_errors
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse
from app.investing.router import (
    _enrich_picking_rows,
    _normalize_stored_picking_row,
    _parse_date,
    _parse_num,
    get_activities,
    get_broker,
    get_broker_source,
    get_holdings,
    get_rates,
    get_refills,
)
from app.investing.stock import StockDetail, fetch_detail
from app.investing.watchlist import _fetch_snapshot, get_news
from app.llm.client import AllModelsFailedError, LLMClient, StructuredResult

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R")

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/investing/analysis", tags=["investing"])

Verdict = Literal["strong_buy", "buy", "hold", "wait", "trim", "avoid"]
Confidence = Literal["low", "medium", "high"]

_NOTES_LIMIT = 3000  # general investing notes sent as context, characters
_TICKER = Path(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-^=]+$")

# The account's data comes through the pages' own endpoints, so the AI sees exactly what the pages show:
# the broker's live numbers when connected, the saved rows otherwise.
BrokerSource = Callable[[UserResponse], Any]


def _from_saved_copy(user: UserResponse, source_for: BrokerSource, *responses: Any) -> bool:
    """A broker is connected, yet at least one of these answers came from the saved rows: it didn't respond."""
    return source_for(user) is not None and any(r.source != "freedom24" for r in responses)


def _account_holdings(conn: Connection, user: UserResponse, source_for: BrokerSource) -> list[dict[str, Any]]:
    return [h.model_dump() for h in get_holdings(user, conn, source_for).holdings]


class StockAnalysis(BaseModel):
    """What Gemini returns (its response_schema) and what's stored."""

    verdict: Verdict = Field(description="Overall call for this investor at today's price.")
    confidence: Confidence
    headline: str = Field(description="One sentence: the verdict and the main reason.")
    summary: str = Field(description="2-4 sentences on the business and the stock right now.")
    price_vs_zones: str = Field(description="Where today's price sits against the investor's strong/may buy levels and the 52-week range.")
    goals_check: str = Field(description="Whether the investor's 1y and 5y price goals look realistic, using the implied returns given.")
    strengths: list[str] = Field(description="2-4 short bullet points.")
    risks: list[str] = Field(description="2-4 short bullet points.")
    action: str = Field(description="One concrete next step for this investor (buy, add, wait for a price, hold, trim, revisit goals).")

    @field_validator("headline", "summary", "price_vs_zones", "goals_check", "action")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be empty")
        return v

    @field_validator("strengths", "risks")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        items = [s.strip() for s in v if s and s.strip()]
        if not 1 <= len(items) <= 5:
            raise ValueError("give 2-4 non-empty items")
        return items

    @field_validator("headline", "summary", "action")
    @classmethod
    def _language(cls, v: str, info: ValidationInfo) -> str:
        # Ukrainian was asked for but the text has no Cyrillic: send it back for a repair.
        if (info.context or {}).get("lang") == "uk" and not re.search(r"[А-Яа-яІіЇїЄєҐґ]", v):
            raise ValueError("must be written in Ukrainian")
        return v


class AnalysisResponse(BaseModel):
    ticker: str
    analysis: StockAnalysis
    model: str  # the Gemini model that answered (may be a fallback)
    lang: str
    price: float | None = None  # price the analysis was made at
    stale_data: bool = False  # made from the saved copy because the broker didn't answer
    created_at: str


def get_llm() -> LLMClient | None:
    """Overridden in main.py with the configured client (None when GEMINI_API_KEY is missing)."""
    return None


def _num(text: Any) -> float | None:
    m = re.search(r"[-+]?\d+(?:\.\d+)?", str(text or "").replace(",", ""))
    return float(m.group(0)) if m else None


def _pct(a: float | None, b: float | None) -> str | None:
    """Change from b to a as "+12.3%"."""
    return f"{(a / b - 1) * 100:+.1f}%" if a and b else None


def _usd(v: float | None) -> str | None:
    # Figures go to the model pre-formatted: it quotes them more faithfully than it formats numbers.
    return f"${v:,.2f}" if v else None


def _plain(text: str) -> str:
    """Notes are rich text: keep the words, drop the markup."""
    text = re.sub(r"<(br|/p|/li|/h\d)[^>]*>", "\n", text, flags=re.I)
    text = unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _gather(
    conn: Connection,
    user: UserResponse,
    ticker: str,
    source_for: BrokerSource,
    weight: float | None = None,
) -> tuple[dict[str, Any], float | None]:
    """Everything known about the ticker (with the arithmetic done here rather than by the model), and today's price."""
    picking = conn.execute("SELECT rows FROM investing_picking WHERE user_id = %s", (user.id,)).fetchone()
    rows = [_normalize_stored_picking_row(r) for r in (picking[0] if picking and isinstance(picking[0], list) else []) if isinstance(r, dict)]
    row = next((r for r in rows if r["ticker"].strip().upper() == ticker), None)

    held = get_holdings(user, conn, source_for)
    holding = next((h.model_dump() for h in held.holdings if h.ticker.strip().upper() == ticker), None)
    if row is None and holding is None:
        raise HTTPException(status_code=404, detail="Ticker is not in your watchlist or portfolio")

    activities = get_activities(user, conn, source_for)
    trades = [
        a.model_dump() for a in activities.activities
        if a.ticker.strip().upper() == ticker and a.type in ("buy", "sell")
    ]
    trades.sort(key=lambda a: _parse_date(a.get("date", "")))  # DD.MM.YYYY: as text, the order would be wrong
    notes = conn.execute("SELECT notes FROM investing_notes WHERE user_id = %s", (user.id,)).fetchone()

    snap = _fetch_snapshot(ticker)
    price = _num(_enrich_picking_rows([row])[0]["current_price"]) if row else None
    if price is None:
        price = snap.price if snap and snap.price else _num(holding.get("marketPrice")) if holding else None

    plan: dict[str, Any] = {}
    if row:
        strong, may = _num(row["strong_buy_until"]), _num(row["may_buy_until"])
        goal_1y, goal_5y = _num(row["price_goal_1y"]), _num(row["price_goal_5y"])
        plan = {
            "bucket": row["bucket"],
            "strong_buy_until": _usd(strong),
            "may_buy_until": _usd(may),
            "price_vs_strong_buy_pct": _pct(price, strong),
            "price_vs_may_buy_pct": _pct(price, may),
            "buy_right_now_note": row["buy_right_now"] or None,
            "price_goal_1y": _usd(goal_1y),
            "upside_to_1y_goal_pct": _pct(goal_1y, price),
            "price_goal_5y": _usd(goal_5y),
            "upside_to_5y_goal_pct": _pct(goal_5y, price),
            "implied_5y_annual_return_pct": f"{((goal_5y / price) ** 0.2 - 1) * 100:+.1f}%" if goal_5y and price else None,
            "notes": _plain(row["notes"]) or None,
        }

    position: dict[str, Any] | None = None
    if holding:
        avg = _num(holding.get("avgBuyPrice"))
        position = {
            "shares": holding.get("shares"),
            "avg_buy_price": _usd(avg),
            "unrealized_return_pct": _pct(price, avg),
            # The page sends the weight at live prices; the stored one is from the last save.
            "current_weight": f"{weight:.1f}%" if weight is not None else holding.get("currentWeight") or None,
            "target_weight": holding.get("targetWeight") or None,
        }

    facts = {
        "ticker": ticker,
        "name": (row or {}).get("name") or (holding or {}).get("name") or (snap.name if snap else ""),
        "industry": (row or {}).get("industry") or (holding or {}).get("industry") or (snap.sector if snap else ""),
        "price": _usd(price),
        "market": snap.model_dump(exclude_none=True) if snap else None,
        "your_plan": plan or None,
        "your_position": position,
        "your_trades": [
            {k: a.get(k) for k in ("date", "type", "count", "price", "currency")} for a in trades[-12:]
        ] or None,
        "general_investing_notes": _plain(notes[0])[:_NOTES_LIMIT] if notes and notes[0] else None,
        "broker_data_unavailable": _from_saved_copy(user, source_for, held, activities) or None,
    }
    return facts, price


_SYSTEM = """You are a careful equity analyst helping one private long-term investor review a stock
they track. Judge the stock against THIS investor's own plan (buy zones, price goals, notes,
position) as well as the market data. Use only the data given: when something is missing, say so
instead of guessing, and never invent figures, events or dates. The percentages in the data are
already computed; reuse them rather than recalculating. Be direct and specific; no generic filler.
This is decision support, not financial advice."""


def _prompt(facts: dict[str, Any], headlines: list[str], lang: str) -> str:
    language = "Ukrainian" if lang == "uk" else "English"
    news = "\n".join(f"- {h}" for h in headlines) or "(no recent headlines)"
    return f"""Analyse {facts["ticker"]} for this investor.

## Data (JSON)
{json.dumps(facts, ensure_ascii=False, indent=1, default=str)}

## Recent headlines
{news}

## Rules
- Write every text field in {language}; keep tickers as they are.
- Quote figures exactly as they appear in the data (e.g. "$564.00", "+10.6%"); don't round or restate them.
- Never show data field names (like may_buy_until); say "your strong-buy level", "your may-buy level", "your 1-year goal".
- verdict: strong_buy / buy = attractive to buy now at this price for this plan; hold = keep, don't add;
  wait = good company but wait for the investor's buy zone; trim = consider reducing (overweight,
  stretched valuation); avoid = thesis looks broken or the risk outweighs the upside.
- price_vs_zones: compare today's price with strong_buy_until / may_buy_until and the 52-week range.
- goals_check: say whether the 1y and 5y goals look realistic given growth, valuation and the implied
  annual return; suggest a range if they look off.
- If the investor owns it, take the position and target weight into account in `action`.
- If broker_data_unavailable is true, the broker didn't answer and the account figures are an older saved copy: say so in
  the summary and be careful with anything that depends on current cash or positions."""


# ---- Shared: run, save, load ----


async def _run(llm: LLMClient | None, prompt: str, schema: type[T], *, label: str, context: dict[str, Any], system: str) -> StructuredResult[T]:
    """One structured Gemini call."""
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    return await _guarded(llm, label, lambda: llm.structured(prompt, schema, context=context, system_instruction=system))


async def _guarded(llm: LLMClient, label: str, call: Callable[[], Awaitable[R]]) -> R:
    """Runs a Gemini call with the errors turned into messages the page can show."""
    try:
        return await call()
    except AllModelsFailedError as exc:
        logger.error("AI analysis for %s failed: %s", label, exc)
        quota = all(reason.startswith("429") for _, reason in exc.failures)
        raise HTTPException(
            status_code=429 if quota else 502,
            detail="Gemini quota is used up — try again later" if quota else "Gemini couldn't produce an analysis — try again",
        ) from exc
    except genai_errors.APIError as exc:
        logger.error("AI analysis for %s failed: %s", label, exc)
        raise HTTPException(
            status_code=502,
            detail="Gemini rejected the API key — check GEMINI_API_KEY" if exc.code in (401, 403) else f"Gemini error {exc.code}",
        ) from exc
    finally:
        logger.info("AI analysis %s: %s", label, llm.usage.summary())


def _save(conn: Connection, user_id: int, key: str, data: dict[str, Any]) -> str:
    row = conn.execute(
        """
        INSERT INTO investing_ai_analyses(user_id, ticker, data, created_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (user_id, ticker) DO UPDATE SET data = EXCLUDED.data, created_at = NOW()
        RETURNING created_at
        """,
        (user_id, key, Json(data)),
    ).fetchone()
    conn.commit()
    return row[0].isoformat()


def _load(conn: Connection, user_id: int, key: str) -> tuple[dict[str, Any], str] | None:
    row = conn.execute(
        "SELECT data, created_at FROM investing_ai_analyses WHERE user_id = %s AND ticker = %s",
        (user_id, key),
    ).fetchone()
    return (row[0], row[1].isoformat()) if row else None


# ---- Whole portfolio ----

# Stored in investing_ai_analyses next to the per-ticker rows; "@" can't start a ticker.
_PORTFOLIO_KEY = "@PORTFOLIO"

Health = Literal["strong", "good", "needs_attention", "at_risk"]
PortfolioMove = Literal["buy", "add", "hold", "trim", "sell", "rebalance", "watch"]


class PortfolioAction(BaseModel):
    action: PortfolioMove
    ticker: str = Field(description="Ticker from the data this step is about, or empty for the whole portfolio.")
    detail: str = Field(description="What to do and why, in one or two sentences, with the figures that justify it.")

    @field_validator("detail")
    @classmethod
    def _detail(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()

    @field_validator("ticker")
    @classmethod
    def _known_ticker(cls, v: str, info: ValidationInfo) -> str:
        # Only tickers the investor holds or watches: no invented picks.
        v = v.strip().upper()
        known = (info.context or {}).get("tickers")
        if v and known is not None and v not in known:
            raise ValueError(f"{v} is not in the portfolio or watchlist; use one of {sorted(known)} or leave it empty")
        return v


AdviceKind = Literal["remove", "reduce", "add", "replace", "keep"]


def _no_field_names(v: str) -> str:
    """The prompt forbids showing data field names, and the model still slips: send those back for a repair."""
    found = re.search(r"\b[a-z0-9]+(?:_[a-z0-9]+)+\b", v)
    if found:
        raise ValueError(f"replace the data field name {found.group(0)} with plain words")
    return v


class PortfolioAdvice(BaseModel):
    """A judgement on what belongs in the portfolio, as opposed to the ordered next steps."""

    action: AdviceKind
    ticker: str = Field(description="The holding or watchlist ticker this is about.")
    related_ticker: str = Field(description="The fund it overlaps with, or what to replace it with; a ticker from the data, or empty.")
    reason: str = Field(description="Why, in one or two sentences, with the figures that prove it.")

    @field_validator("ticker", "related_ticker")
    @classmethod
    def _known(cls, v: str, info: ValidationInfo) -> str:
        return PortfolioAction._known_ticker(v, info)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v: str, info: ValidationInfo) -> str:
        return _no_field_names(StockAnalysis._language(StockAnalysis._not_blank(v), info))

    @model_validator(mode="after")
    def _about_something_real(self, info: ValidationInfo) -> "PortfolioAdvice":
        if not self.ticker:
            raise ValueError("advice must name a ticker")
        owned = (info.context or {}).get("owned")
        if owned is not None and self.action != "add" and self.ticker not in owned:
            raise ValueError(f"{self.ticker} isn't held, so it can't be removed, reduced, replaced or kept")
        return self


class PortfolioQuestion(BaseModel):
    question: str = Field(description="A specific question this investor should think about.")
    answer: str = Field(description="Your answer to it, in one to three sentences, with the figures behind it.")

    @field_validator("question", "answer")
    @classmethod
    def _text(cls, v: str, info: ValidationInfo) -> str:
        return _no_field_names(StockAnalysis._language(StockAnalysis._not_blank(v), info))


class PortfolioAnalysis(BaseModel):
    """What Gemini returns for the whole portfolio, and what's stored."""

    health: Health = Field(description="Overall state of the portfolio for a long-term investor.")
    confidence: Confidence
    headline: str = Field(description="One sentence: the overall picture and the most important issue.")
    summary: str = Field(description="3-5 sentences: what the portfolio is, how it's doing, what matters most now.")
    diversification: str = Field(description="Concentration, sector and fund vs single-stock mix, drift from target weights.")
    performance: str = Field(description="Returns vs money deposited and vs cost, realized gains, dividends and income.")
    valuation_risk: str = Field(description="Valuation level, how stretched the holdings are, and the main risk exposures.")
    strengths: list[str] = Field(description="2-4 short bullet points.")
    risks: list[str] = Field(description="2-4 short bullet points.")
    actions: list[PortfolioAction] = Field(description="2-6 concrete steps, most important first.")
    cash_plan: str = Field(description="How to use the available cash and the next deposits: which holdings or watchlist stocks, and at what prices.")
    advice: list[PortfolioAdvice] = Field(description="What to remove, reduce, add, replace or deliberately keep, and why. Empty if nothing should change.")
    questions: list[PortfolioQuestion] = Field(description="2-4 questions worth thinking about, each with your answer.")

    @field_validator("headline", "summary", "diversification", "performance", "valuation_risk", "cash_plan")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        return StockAnalysis._not_blank(v)

    @field_validator("strengths", "risks")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        return StockAnalysis._bullets(v)

    @field_validator("headline", "summary", "cash_plan")
    @classmethod
    def _language(cls, v: str, info: ValidationInfo) -> str:
        return StockAnalysis._language(v, info)

    @field_validator("actions")
    @classmethod
    def _actions(cls, v: list[PortfolioAction]) -> list[PortfolioAction]:
        if not 1 <= len(v) <= 6:
            raise ValueError("give 2-6 actions")
        return v

    @field_validator("advice")
    @classmethod
    def _advice(cls, v: list[PortfolioAdvice]) -> list[PortfolioAdvice]:
        if len(v) > 8:
            raise ValueError("give at most 8 pieces of advice, the most important ones")
        return v

    @field_validator("questions")
    @classmethod
    def _questions(cls, v: list[PortfolioQuestion], info: ValidationInfo) -> list[PortfolioQuestion]:
        # A fresh answer must have them (context is set); reviews saved before they existed stay readable.
        if len(v) > 5 or (info.context and not v):
            raise ValueError("give 2-4 questions")
        return v


class PortfolioAnalysisResponse(BaseModel):
    analysis: PortfolioAnalysis
    model: str
    lang: str
    account_value: float | None = None  # positions + cash when the review was made
    stale_data: bool = False  # made from the saved copy because the broker didn't answer
    created_at: str


def _dmy_ts(text: str) -> float | None:
    """Unix time of a "DD.MM.YYYY" date."""
    m = re.match(r"\s*(\d{1,2})\.(\d{1,2})\.(\d{4})", text or "")
    if not m:
        return None
    try:
        return datetime(int(m.group(3)), int(m.group(2)), int(m.group(1))).timestamp()
    except ValueError:
        return None


def _signed_usd(v: float) -> str:
    return f"{'+' if v >= 0 else '−'}${abs(v):,.2f}"


def _gather_portfolio(conn: Connection, user: UserResponse, source_for: BrokerSource) -> tuple[dict[str, Any], float, set[str]]:
    """The whole account at live prices, with every ratio worked out here. Returns (facts, account value, known tickers)."""
    held = get_holdings(user, conn, source_for)
    holdings = [h for h in (x.model_dump() for x in held.holdings) if str(h.get("ticker", "")).strip() and float(h.get("shares") or 0) > 0]
    if not holdings:
        raise HTTPException(status_code=404, detail="No holdings yet — add them on the Portfolio tab")

    picking = conn.execute("SELECT rows FROM investing_picking WHERE user_id = %s", (user.id,)).fetchone()
    watch = [_normalize_stored_picking_row(r) for r in (picking[0] if picking and isinstance(picking[0], list) else []) if isinstance(r, dict)]
    owned = list(dict.fromkeys(str(h["ticker"]).strip().upper() for h in holdings))
    tickers = list(dict.fromkeys([*owned, *(r["ticker"].strip().upper() for r in watch if r["ticker"].strip())]))

    quotes = {r["ticker"].strip().upper(): r for r in _enrich_picking_rows([{"ticker": t} for t in tickers])}
    with ThreadPoolExecutor(max_workers=10) as pool:
        snaps = dict(zip(owned, pool.map(_fetch_snapshot, owned)))

    positions: list[dict[str, Any]] = []
    for h in holdings:
        t = str(h["ticker"]).strip().upper()
        shares = float(h.get("shares") or 0)
        price = _num(quotes.get(t, {}).get("current_price")) or _num(h.get("marketPrice")) or 0.0
        snap = snaps.get(t)
        positions.append({
            "ticker": t,
            "name": h.get("name") or (snap.name if snap else ""),
            "kind": "fund" if snap and snap.is_fund else "stock",
            "sector": (snap.sector if snap and snap.sector else "") or str(h.get("industry") or "").strip() or "Unclassified",
            "value": shares * price,
            "cost": shares * (_num(h.get("avgBuyPrice")) or 0.0),
            "price": price,
            "day": _num(quotes.get(t, {}).get("day_change_pct")),
            "target": _num(h.get("targetWeight")),
            "snap": snap,
        })
    positions.sort(key=lambda p: -p["value"])
    invested = sum(p["value"] for p in positions)
    cost = sum(p["cost"] for p in positions)

    broker = get_broker(user, conn, source_for)
    to_usd = get_rates(user=user).to_usd
    cash = sum(_parse_num(c.amount) * to_usd.get((c.currency or "USD").strip().upper(), 0.0) for c in broker.cash)
    year_ago = datetime.now().timestamp() - 365 * 86400
    dividends_12m = sum(d.amount_usd for d in broker.dividends if (ts := _dmy_ts(d.date)) and ts >= year_ago)

    refills = get_refills(user, conn, source_for)
    deposited = sum(_parse_num(r.amount) for r in refills.rows)

    activities = get_activities(user, conn, source_for)
    summary = activities.yearly_summary
    realized = sum(_parse_num(y.sales_pnl) for y in summary)
    fees = sum(_parse_num(y.purchases_commission) + _parse_num(y.sales_commission) for y in summary)

    notes = conn.execute("SELECT notes FROM investing_notes WHERE user_id = %s", (user.id,)).fetchone()
    account = invested + cash

    def weight(v: float) -> float:
        return v / invested * 100 if invested else 0.0

    sectors: dict[str, float] = {}
    for p in positions:
        sectors[p["sector"]] = sectors.get(p["sector"], 0.0) + weight(p["value"])
    stocks = [p for p in positions if p["kind"] == "stock"]

    def weighted(attr: str, items: list[dict[str, Any]]) -> float | None:
        """Value-weighted average of a snapshot field; None when under half of the value has it."""
        pairs = [(getattr(p["snap"], attr), p["value"]) for p in items if p["snap"] and getattr(p["snap"], attr) is not None]
        covered = sum(v for _, v in pairs)
        return sum(x * v for x, v in pairs) / covered if pairs and covered >= sum(p["value"] for p in items) * 0.5 else None

    fwd_pe = weighted("forward_pe", stocks)
    div_yield = weighted("div_yield", positions)
    day_move = sum(p["value"] - p["value"] / (1 + p["day"] / 100) for p in positions if p["day"] is not None)

    def position_facts(p: dict[str, Any]) -> dict[str, Any]:
        s = p["snap"]
        w = weight(p["value"])
        return {
            "ticker": p["ticker"],
            "name": p["name"],
            "kind": p["kind"],
            "sector": p["sector"],
            "value": _usd(p["value"]),
            "weight": f"{w:.1f}%",
            "target_weight": f"{p['target']:.1f}%" if p["target"] else None,
            "drift_from_target": f"{w - p['target']:+.1f} pp" if p["target"] else None,
            "return_on_cost": _pct(p["value"], p["cost"]),
            "today": f"{p['day']:+.2f}%" if p["day"] is not None else None,
            "pe": s.pe if s else None,
            "forward_pe": s.forward_pe if s else None,
            "div_yield": f"{s.div_yield:.2f}%" if s and s.div_yield is not None else None,
            "perf_1y": f"{s.perf['1Y']:+.1f}%" if s and "1Y" in s.perf else None,
            "from_52w_high": _pct(p["price"], s.high_52w) if s else None,
            "analyst_target_upside": _pct(s.target_price, p["price"]) if s and s.target_price else None,
            "expense_ratio": f"{s.expense:.2f}%" if s and s.expense is not None else None,
        }

    watchlist: list[dict[str, Any]] = []
    for r in watch:
        t = r["ticker"].strip().upper()
        price = _num(quotes.get(t, {}).get("current_price"))
        strong, may = _num(r["strong_buy_until"]), _num(r["may_buy_until"])
        if not t or not (strong or may):
            continue
        zone = (
            "in strong buy zone" if price and strong and price <= strong
            else "in may buy zone" if price and may and price <= may
            else "above buy zones"
        )
        watchlist.append({
            "ticker": t,
            "owned": t in owned,
            "price": _usd(price),
            "strong_buy_until": _usd(strong),
            "may_buy_until": _usd(may),
            "now": zone,
            "price_vs_may_buy": _pct(price, may),
            "price_goal_5y": _usd(_num(r["price_goal_5y"])),
        })

    facts = {
        "account": {
            "account_value": _usd(account),
            "invested_in_positions": _usd(invested),
            "cash": _usd(cash) or "$0.00",
            "cash_share": f"{cash / account * 100:.1f}%" if account else None,
            "money_deposited_total": _usd(deposited),
            "gain_vs_deposits": f"{_signed_usd(account - deposited)} ({_pct(account, deposited)})" if deposited else None,
            "unrealized_gain_vs_cost": f"{_signed_usd(invested - cost)} ({_pct(invested, cost)})" if cost else None,
            "account_change_today": _signed_usd(day_move),
            "realized_gains_from_sales": _signed_usd(realized),
            "fees_paid": _usd(fees) or "$0.00",
            "dividends_last_12_months": _usd(dividends_12m) or "$0.00" if broker.dividends else None,
        },
        "shape": {
            "positions": len(positions),
            "funds_share": f"{sum(weight(p['value']) for p in positions if p['kind'] == 'fund'):.1f}%",
            "largest_position": f"{positions[0]['ticker']} {weight(positions[0]['value']):.1f}%",
            "top_3_share": f"{sum(weight(p['value']) for p in positions[:3]):.1f}%",
            "sectors": {k: f"{v:.1f}%" for k, v in sorted(sectors.items(), key=lambda kv: -kv[1])},
            "weighted_forward_pe_of_stocks": f"{fwd_pe:.1f}" if fwd_pe else None,
            "weighted_dividend_yield": f"{div_yield:.2f}%" if div_yield is not None else None,
            "in_profit": sum(1 for p in positions if p["value"] > p["cost"]),
            "in_loss": sum(1 for p in positions if p["value"] < p["cost"]),
        },
        "positions": [position_facts(p) for p in positions],
        "watchlist_buy_zones": watchlist or None,
        "general_investing_notes": _plain(notes[0])[:_NOTES_LIMIT] if notes and notes[0] else None,
        "broker_data_unavailable": _from_saved_copy(user, source_for, held, broker, refills, activities) or None,
    }
    return facts, account, set(tickers)


def fund_overlaps(funds: dict[str, list[Any]]) -> list[dict[str, Any]]:
    """Each pair of funds sharing top positions, biggest overlap first. Only top positions are published, so it's a minimum."""
    pairs: list[tuple[float, dict[str, Any]]] = []
    names = sorted(funds)
    for i, a in enumerate(names):
        weights = {h.symbol: h.weight for h in funds[a]}
        for b in names[i + 1:]:
            shared = sorted(((min(weights[h.symbol], h.weight), h.symbol) for h in funds[b] if h.symbol in weights), reverse=True)
            if shared:
                total = sum(w for w, _ in shared)
                pairs.append((total, {
                    "funds": [a, b],
                    "shared_top_positions": [s for _, s in shared],
                    "minimum_overlap": f"{total:.1f}%",
                }))
    return [p for _, p in sorted(pairs, key=lambda x: -x[0])]


def stocks_inside_funds(stocks: set[str], funds: dict[str, list[Any]]) -> dict[str, list[str]]:
    """Stocks held directly that the funds also hold: ticker → ["QQQM 8.2%", …]."""
    found: dict[str, list[str]] = {}
    for fund, holdings in sorted(funds.items()):
        for h in holdings:
            if h.symbol in stocks:
                found.setdefault(h.symbol, []).append(f"{fund} {h.weight:.1f}%")
    return found


def _portfolio_insights(positions: list[dict[str, Any]]) -> dict[str, Any]:
    """The evidence for advice on single holdings: how each business is doing and what the funds really hold."""
    tickers = list(dict.fromkeys(p["ticker"] for p in positions))
    with ThreadPoolExecutor(max_workers=5) as pool:
        details = dict(zip(tickers, pool.map(fetch_detail, tickers)))
    funds = {t: d.fund_holdings for t, d in details.items() if d and d.is_fund and d.fund_holdings}
    stocks = {t for t, d in details.items() if d and not d.is_fund}

    quality: dict[str, Any] = {}
    for t in sorted(stocks):
        s, cur = details[t].stats, details[t].financial_currency
        quality[t] = {
            "revenue_growth_yoy": _percent_text(s.revenue_growth, True),
            "earnings_growth_yoy": _percent_text(s.earnings_growth, True),
            "operating_margin": _percent_text(s.operating_margin),
            "profit_margin": _percent_text(s.profit_margin),
            "free_cash_flow_yield": _percent_text(s.fcf_yield),
            "net_cash": _money(s.net_cash, cur) if s.net_cash is not None and s.net_cash >= 0 else None,
            "net_debt": _money(-s.net_cash, cur) if s.net_cash is not None and s.net_cash < 0 else None,
            "peg": _ratio(s.peg),
            "analyst_mean_1_strong_buy_to_5_sell": f"{s.recommendation:.2f}" if s.recommendation is not None else None,
        }
    return {
        "stock_quality": quality or None,
        "fund_top_positions": {f: [f"{h.symbol} {h.weight:.1f}%" for h in hs] for f, hs in funds.items()} or None,
        "fund_overlap": fund_overlaps(funds) or None,
        "stocks_also_inside_your_funds": stocks_inside_funds(stocks, funds) or None,
    }


_PORTFOLIO_SYSTEM = """You are a careful portfolio analyst reviewing the whole brokerage account of one
private long-term investor. Judge it as a portfolio — diversification, concentration, drift from
the investor's own target weights, valuation, income, risk and how the cash is used — and call out
single holdings where they weaken it. Use only the data given: when something is missing, say so instead of guessing, and never
invent figures, events or dates. All figures are already computed; reuse them rather than
recalculating. Be direct and specific; no generic filler. This is decision support, not financial
advice."""


def _portfolio_prompt(facts: dict[str, Any], lang: str) -> str:
    language = "Ukrainian" if lang == "uk" else "English"
    return f"""Review this investor's portfolio.

## Data (JSON)
{json.dumps(facts, ensure_ascii=False, indent=1, default=str)}

## Rules
- Write every text field in {language}; keep tickers as they are.
- Quote figures exactly as they appear in the data (e.g. "$1,234.56", "+10.6%", "+2.1 pp"); don't round or restate them.
- Never show data field names; describe them in plain words.
- health: strong = well diversified, on target, sensible valuation; good = minor issues; needs_attention =
  clear concentration, drift or valuation issues to fix; at_risk = large concentration or losses that threaten the plan.
- diversification: name the largest positions and sectors, the fund vs single-stock mix, and the biggest drifts
  from target weights.
- actions: concrete steps, most important first; `ticker` must be one of the tickers in the data or empty.
  Prefer rebalancing through new money over selling when drift is moderate.
- cash_plan: say where the cash and next deposits should go — underweight holdings and watchlist stocks that
  are in a buy zone, with their prices; if nothing is in a buy zone, say what to wait for.
- advice: be blunt about what doesn't belong. remove = drop it; reduce = hold less; replace = swap it for
  `related_ticker`; add = a watchlist stock or holding to buy more of; keep = only for a position that looks
  cuttable but should stay. Every reason must cite evidence from the data: weak growth, margins or debt in
  stock_quality, a poor return or analyst view in positions, an overlap in fund_overlap or
  stocks_also_inside_your_funds, drift or a position too small to matter. Give no advice you can't back with data,
  and leave the list empty if nothing should change. Most important first. For an overlap, put the other fund in
  related_ticker and say which of the two to keep and why. Present an overlap as a minimum, in the language of the review (never the English
  words "at least"): only funds' top positions are known, so the true overlap is higher. Respect the investor's notes, and say so if advice goes against them.
- actions are the ordered steps; advice is the judgement on what belongs. Don't repeat the same wording in both.
- questions: 2-4 questions specific to this portfolio that the investor should think about (e.g. whether they need
  two funds that hold the same stocks, or what a position is for), each with your own direct answer and its figures.
  No generic questions like "what is your risk tolerance?" unless the data makes it the real issue.
- If broker_data_unavailable is true, the broker didn't answer and the account figures are an older saved copy: say so in
  the summary and be careful with anything that depends on current cash or positions."""


@router.get("/portfolio", response_model=PortfolioAnalysisResponse | None)
def get_portfolio_analysis(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """The last saved portfolio review, or null."""
    saved = _load(conn, user.id, _PORTFOLIO_KEY)
    if not saved:
        return None
    try:
        # Reviews saved before advice and questions existed stay readable until the next run.
        if isinstance(saved[0].get("analysis"), dict):
            saved[0]["analysis"].setdefault("advice", [])
            saved[0]["analysis"].setdefault("questions", [])
        return PortfolioAnalysisResponse(**saved[0], created_at=saved[1])
    except Exception:  # stored with an older shape
        return None


@router.post("/portfolio", response_model=PortfolioAnalysisResponse)
async def analyze_portfolio(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    source_for: Annotated[BrokerSource, Depends(get_broker_source)],
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    facts, account, tickers = await run_in_threadpool(_gather_portfolio, conn, user, source_for)
    facts.update(await run_in_threadpool(_portfolio_insights, facts["positions"]))
    result = await _run(
        llm,
        _portfolio_prompt(facts, lang),
        PortfolioAnalysis,
        label="portfolio",
        context={"lang": lang, "tickers": tickers, "owned": {p["ticker"] for p in facts["positions"]}},
        system=_PORTFOLIO_SYSTEM,
    )
    data = {
        "analysis": result.value.model_dump(),
        "model": result.model,
        "lang": lang,
        "account_value": round(account, 2),
        "stale_data": bool(facts["broker_data_unavailable"]),
    }
    created_at = await run_in_threadpool(_save, conn, user.id, _PORTFOLIO_KEY, data)
    return PortfolioAnalysisResponse(**data, created_at=created_at)


# ---- Stock page: should I buy this now, given the company, my price and my portfolio? ----

# Same rules as the Watchlist page (BUCKETS in front/src/app/investing/picking/page.tsx).
_BUCKET_RULES = {
    "etf_reit_fund": {"title": "ETF / REIT / Fund", "target": 40.0, "max": 5},
    "value_blue_chips": {"title": "Value / Blue chips", "target": 40.0, "max": 10},
}

Zone = Literal["strong", "may", "above", "unset"]
Room = Literal["room", "full", "unknown"]
BuyVerdict = Literal["buy", "buy_partial", "wait_price", "no_room", "avoid"]
CompanyHealth = Literal["strong", "solid", "mixed", "weak"]


class StockFit(BaseModel):
    """The checks that are arithmetic, not opinion: worked out here, shown as is, and given to the model."""

    ticker: str
    price: float | None = None
    zone: Zone = "unset"
    strong_buy: float | None = None
    may_buy: float | None = None
    on_watchlist: bool = False
    owned: bool = False
    shares: float = 0.0
    value: float = 0.0
    weight: float | None = None  # % of invested money, as on the Portfolio page
    target_weight: float | None = None
    room: Room = "unknown"
    room_basis: Literal["target", "bucket", "none"] = "none"
    full_reason: Literal["target", "bucket_weight", "bucket_positions"] | None = None
    room_usd: float | None = None  # how much more fits once the cash is invested too
    cash: float | None = None
    max_buy_usd: float | None = None  # room, capped by the cash
    max_buy_shares: int | None = None
    bucket: str | None = None
    bucket_weight: float | None = None
    bucket_target: float | None = None
    bucket_positions: int | None = None
    bucket_max: int | None = None
    sector: str | None = None
    sector_weight: float | None = None
    stale_data: bool = False  # cash and positions are the saved copy because the broker didn't answer


def compute_fit(
    ticker: str,
    price: float | None,
    row: dict[str, Any] | None,
    positions: list[dict[str, Any]],
    target_weight: float | None,
    cash: float | None,
    sector: str | None = None,
) -> StockFit:
    """`positions`: {"ticker", "value", "shares", "bucket", "industry", "sector"} at live prices. `row`: the watchlist row, if any."""
    strong, may = _num(row["strong_buy_until"]) if row else None, _num(row["may_buy_until"]) if row else None
    zone: Zone = "unset"
    if price and (strong or may):
        zone = "strong" if strong and price <= strong else "may" if may and price <= may else "above"

    invested = sum(p["value"] for p in positions)
    account = invested + (cash or 0.0)
    mine = [p for p in positions if p["ticker"] == ticker]
    value = sum(p["value"] for p in mine)
    owned = bool(mine)
    weight = value / invested * 100 if invested else None
    target = target_weight if target_weight and target_weight > 0 else None

    bucket = row["bucket"] if row and row.get("bucket") in _BUCKET_RULES else None
    if bucket is None and owned:
        bucket = mine[0].get("bucket") if mine[0].get("bucket") in _BUCKET_RULES else None
    rule = _BUCKET_RULES.get(bucket or "")

    bucket_value: float | None = None
    bucket_tickers: set[str] = set()
    if rule:
        in_bucket = [p for p in positions if p.get("bucket") == bucket]
        bucket_tickers = {p["ticker"] for p in in_bucket}
        bucket_value = sum(p["value"] for p in in_bucket)

    room: Room = "unknown"
    basis: Literal["target", "bucket", "none"] = "none"
    reason: Literal["target", "bucket_weight", "bucket_positions"] | None = None
    room_usd: float | None = None
    if account > 0 and target is not None:
        basis = "target"
        room_usd = target / 100 * account - value
        # At or over target as the Portfolio page shows it is full, however much cash is waiting.
        room = "full" if (weight or 0.0) >= target else "room"
        reason = "target" if room == "full" else None
    elif account > 0 and rule and bucket_value is not None:
        basis = "bucket"
        room_usd = rule["target"] / 100 * account - bucket_value
        no_slot = not owned and len(bucket_tickers) >= rule["max"]
        over = invested > 0 and bucket_value / invested * 100 >= rule["target"]
        room = "full" if no_slot or over else "room"
        reason = "bucket_positions" if no_slot else "bucket_weight" if room == "full" else None

    max_buy: float | None = None
    if room == "room" and room_usd is not None:
        max_buy = min(room_usd, cash) if cash is not None else room_usd

    sector_weight = None
    if sector and invested:
        sector_weight = sum(p["value"] for p in positions if p.get("sector") == sector) / invested * 100

    return StockFit(
        ticker=ticker,
        price=price,
        zone=zone,
        strong_buy=strong,
        may_buy=may,
        on_watchlist=row is not None,
        owned=owned,
        shares=sum(p.get("shares") or 0.0 for p in mine),
        value=round(value, 2),
        weight=round(weight, 2) if weight is not None else None,
        target_weight=target,
        room=room,
        room_basis=basis,
        full_reason=reason,
        room_usd=round(room_usd, 2) if room_usd is not None else None,
        cash=round(cash, 2) if cash is not None else None,
        max_buy_usd=round(max_buy, 2) if max_buy is not None else None,
        max_buy_shares=int(max_buy // price) if max_buy is not None and price else None,
        bucket=bucket,
        bucket_weight=round(bucket_value / invested * 100, 2) if bucket_value is not None and invested else None,
        bucket_target=rule["target"] if rule else None,
        bucket_positions=len(bucket_tickers) if rule else None,
        bucket_max=rule["max"] if rule else None,
        sector=sector,
        sector_weight=round(sector_weight, 2) if sector_weight is not None else None,
    )


def _stock_fit(conn: Connection, user: UserResponse, ticker: str, detail: StockDetail | None, source_for: BrokerSource) -> StockFit:
    """The fit at live prices. Without any holdings there's simply nothing to compare with."""
    picking = conn.execute("SELECT rows FROM investing_picking WHERE user_id = %s", (user.id,)).fetchone()
    rows = [_normalize_stored_picking_row(r) for r in (picking[0] if picking and isinstance(picking[0], list) else []) if isinstance(r, dict)]
    row = next((r for r in rows if r["ticker"].strip().upper() == ticker), None)
    bucket_of = {r["ticker"].strip().upper(): r["bucket"] for r in rows}

    by_ticker = {str(h.get("ticker", "")).strip().upper(): h for h in _account_holdings(conn, user, source_for)}
    # A target can be set on a saved row before you own the stock, and the broker lists only what you own.
    stored = conn.execute("SELECT holdings FROM investing_holdings WHERE user_id = %s", (user.id,)).fetchone()
    saved = {str(h.get("ticker", "")).strip().upper(): h for h in (stored[0] if stored and isinstance(stored[0], list) else []) if isinstance(h, dict)}
    target = _num(by_ticker.get(ticker, {}).get("targetWeight")) or _num(saved.get(ticker, {}).get("targetWeight"))

    positions: list[dict[str, Any]] = []
    cash: float | None = None
    stale = False
    try:
        facts, _, _ = _gather_portfolio(conn, user, source_for)
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
    else:
        cash = _num(facts["account"]["cash"]) or 0.0
        stale = bool(facts["broker_data_unavailable"])
        for p in facts["positions"]:
            held = by_ticker.get(p["ticker"], {})
            industry = str(held.get("industry") or "")
            positions.append({
                "ticker": p["ticker"],
                "value": _num(p["value"]) or 0.0,
                "shares": float(held.get("shares") or 0),
                "industry": industry,
                "sector": p["sector"],
                # As on the Watchlist page: a watchlist row decides, otherwise funds count as ETF / REIT / Fund.
                "bucket": bucket_of.get(p["ticker"]) or ("etf_reit_fund" if industry.strip().upper().startswith("ETF") else None),
            })

    price = _num(_enrich_picking_rows([{"ticker": ticker}])[0]["current_price"])
    if price is None and detail:
        price = detail.price
    sector = next((p["sector"] for p in positions if p["ticker"] == ticker), None) or (detail.profile.sector if detail else None) or None
    fit = compute_fit(ticker, price, row, positions, target, cash, sector)
    fit.stale_data = stale
    return fit


class StockReview(BaseModel):
    """What Gemini returns for the stock page, and what's stored."""

    verdict: BuyVerdict = Field(description="Should this investor buy today, at today's price, with their portfolio?")
    confidence: Confidence
    headline: str = Field(description="One sentence: the decision and the main reason.")
    company_health: CompanyHealth = Field(description="State of the business right now, regardless of the share price.")
    company_state: str = Field(description="3-5 sentences: how the business is doing now: growth, margins, cash, debt, recent events.")
    valuation: str = Field(description="1-3 sentences: is today's price expensive for this business, using the multiples, yields and analyst targets given.")
    price_check: str = Field(description="1-2 sentences: is the investor's own buy level sensible for this company, and how today's price compares with it.")
    portfolio_check: str = Field(description="1-3 sentences: does this fit the portfolio now: room to target or bucket, cash available, concentration.")
    strengths: list[str] = Field(description="2-4 short bullet points.")
    risks: list[str] = Field(description="2-4 short bullet points.")
    action: str = Field(description="One concrete step: how much to buy and up to what price, or the price or event to wait for.")
    change_mind: str = Field(description="One sentence: what would change this decision.")

    @field_validator("headline", "company_state", "valuation", "price_check", "portfolio_check", "action", "change_mind")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        return StockAnalysis._not_blank(v)

    @field_validator("strengths", "risks")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        return StockAnalysis._bullets(v)

    @field_validator("headline", "company_state", "action")
    @classmethod
    def _language(cls, v: str, info: ValidationInfo) -> str:
        return StockAnalysis._language(v, info)

    @field_validator("verdict")
    @classmethod
    def _buy_needs_price_and_room(cls, v: str, info: ValidationInfo) -> str:
        # The investor's own rules are not the model's to overrule: it may refuse a buy they allow, never the reverse.
        if v in ("buy", "buy_partial"):
            ctx = info.context or {}
            if ctx.get("zone") == "above":
                raise ValueError("today's price is above the investor's buy levels: use wait_price (or avoid)")
            if ctx.get("room") == "full":
                raise ValueError("the portfolio has no room for this stock: use no_room (or avoid)")
        return v


class StockReviewResponse(BaseModel):
    ticker: str
    review: StockReview
    model: str
    lang: str
    fit: StockFit  # the checks as they were when the review was made
    created_at: str


def _review_key(ticker: str) -> str:
    # Next to the Watchlist's shorter per-ticker analysis; "@" can't start a ticker.
    return f"@REVIEW:{ticker}"


def _money(v: float | None, currency: str = "USD") -> str | None:
    if v is None:
        return None
    sign, a = "-" if v < 0 else "", abs(v)
    text = f"{a / 1e12:.2f}T" if a >= 1e12 else f"{a / 1e9:.2f}B" if a >= 1e9 else f"{a / 1e6:.1f}M" if a >= 1e6 else f"{a:,.2f}"
    return f"{sign}${text}" if currency == "USD" else f"{sign}{text} {currency}"


def _percent_text(v: float | None, signed: bool = False) -> str | None:
    return None if v is None else f"{v:+.1f}%" if signed else f"{v:.1f}%"


def _ratio(v: float | None) -> str | None:
    return None if v is None else f"{v:.1f}"


_ESTIMATE_PERIODS = {"0q": "current quarter", "+1q": "next quarter", "0y": "current fiscal year", "+1y": "next fiscal year"}


def _company_facts(d: StockDetail) -> dict[str, Any]:
    """The company's numbers, pre-formatted so they're quoted faithfully."""
    s, cur = d.stats, d.financial_currency
    sold = sum(t.value or 0 for t in d.insiders if t.kind == "sell")
    bought = sum(t.value or 0 for t in d.insiders if t.kind == "buy")

    def money(points: list[Any]) -> dict[str, Any]:
        return {p.period: _money(p.value, cur) for p in points}

    def reported(f: Any) -> dict[str, Any] | None:
        if not f.revenue:
            return None
        return {
            "revenue": money(f.revenue),
            "net_income": money(f.net_income),
            "free_cash_flow": money(f.fcf),
            "eps": {p.period: f"{p.value:.2f}" for p in f.eps},
        }

    return {
        "is_fund": d.is_fund,
        "sector": d.profile.sector or None,
        "industry": d.profile.industry or None,
        "description": d.profile.summary[:800] or None,
        "next_earnings": d.earnings_date,
        "next_earnings_date_is_estimate": d.earnings_date_estimated if d.earnings_date else None,
        "market_cap": _money(s.market_cap, d.currency),
        "valuation": {
            "pe": _ratio(s.pe),
            "forward_pe": _ratio(s.forward_pe),
            "peg": _ratio(s.peg),
            "price_to_sales": _ratio(s.price_to_sales),
            "ev_to_ebitda": _ratio(s.ev_ebitda),
            "free_cash_flow_yield": _percent_text(s.fcf_yield),
            "free_cash_flow_yield_after_stock_comp": _percent_text(s.fcf_yield_after_sbc),
        },
        "profitability": {
            "gross_margin": _percent_text(s.gross_margin),
            "operating_margin": _percent_text(s.operating_margin),
            "profit_margin": _percent_text(s.profit_margin),
            "return_on_equity": _percent_text(s.return_on_equity),
            "revenue_growth_latest_quarter_yoy": _percent_text(s.revenue_growth, True),
            "earnings_growth_latest_quarter_yoy": _percent_text(s.earnings_growth, True),
        },
        "balance_sheet": {
            "cash": _money(s.cash, cur),
            "debt": _money(s.debt, cur),
            # Named by its sign, so the text never reads "net debt of -$37B".
            "net_cash": _money(s.net_cash, cur) if s.net_cash is not None and s.net_cash >= 0 else None,
            "net_debt": _money(-s.net_cash, cur) if s.net_cash is not None and s.net_cash < 0 else None,
        },
        "income": {"dividend_yield": _percent_text(s.div_yield), "payout_ratio": _percent_text(s.payout_ratio), "expense_ratio": _percent_text(s.expense_ratio)},
        "price_context": {
            "beta": f"{s.beta:.2f}" if s.beta is not None else None,
            "high_52w": _money(s.high_52w, d.currency),
            "low_52w": _money(s.low_52w, d.currency),
            "avg_50_day": _money(s.ma_50, d.currency),
            "avg_200_day": _money(s.ma_200, d.currency),
        },
        "analysts": {
            "count": s.analysts,
            "mean_recommendation_1_strong_buy_to_5_sell": f"{s.recommendation:.2f}" if s.recommendation is not None else None,
            "target_mean": _money(s.target_mean, d.currency),
            "target_low": _money(s.target_low, d.currency),
            "target_high": _money(s.target_high, d.currency),
            "upside_to_mean_target": _pct(s.target_mean, d.price),
            "estimates": [
                {
                    "period": _ESTIMATE_PERIODS[e.period],
                    "eps": f"{e.eps_avg:.2f}" if e.eps_avg is not None else None,
                    "eps_growth": _percent_text(e.eps_growth, True),
                    "revenue": _money(e.revenue_avg, cur),
                }
                for e in d.estimates
            ] or None,
        },
        "reported_quarters": reported(d.quarterly),
        "reported_years": reported(d.annual),
        "insiders_last_12_months": {"sold": _money(sold) or "$0", "bought": _money(bought) or "$0", "trades": len(d.insiders)} if d.insiders else None,
    }


_ZONE_TEXT = {
    "strong": "inside the strong-buy zone",
    "may": "inside the may-buy zone",
    "above": "above both buy levels",
    "unset": "the investor has set no buy levels",
}
_FULL_TEXT = {
    "target": "already at or over the target weight",
    "bucket_weight": "the bucket is at or over its target share",
    "bucket_positions": "the bucket already has its maximum number of positions",
}


def _fit_facts(f: StockFit) -> dict[str, Any]:
    room = (
        "there is room" if f.room == "room"
        else _FULL_TEXT.get(f.full_reason or "", "no room") if f.room == "full"
        else "unknown: no target weight or bucket is set"
    )
    return {
        "price_vs_your_levels": _ZONE_TEXT[f.zone],
        "room_in_portfolio": room,
        "room_measured_against": {"target": "this stock's target weight", "bucket": "the bucket's target share", "none": None}[f.room_basis],
        "room_amount": _money(f.room_usd) if f.room == "room" else None,
        "cash_available": _money(f.cash) if f.cash else "$0.00" if f.cash is not None else None,
        "most_you_can_buy_now": _money(f.max_buy_usd),
        "most_whole_shares_you_can_buy_now": f.max_buy_shares,
        "bucket": _BUCKET_RULES[f.bucket]["title"] if f.bucket else None,
        "bucket_share_now": f"{f.bucket_weight:.1f}%" if f.bucket_weight is not None else None,
        "bucket_target_share": f"{f.bucket_target:.0f}%" if f.bucket_target is not None else None,
        "bucket_positions": f"{f.bucket_positions} of max {f.bucket_max}" if f.bucket_positions is not None else None,
        "sector_share_of_portfolio": f"{f.sector_weight:.1f}%" if f.sector_weight is not None else None,
    }


_REVIEW_SYSTEM = """You are a careful equity analyst helping one private long-term investor decide whether
to buy a stock today. Answer three questions: is the business healthy right now, is today's price good
(against the investor's own buy levels and against the valuation), and does it fit their portfolio. The
investor's buy levels and portfolio limits are their rules: a price above their levels or a full position
means no buy today, however good the company. Their price being reached is not enough either: when the
business has deteriorated, say so and advise against buying. Use only the data given: when something is
missing, say so instead of guessing, and never invent figures, events or dates. All figures are already
computed; reuse them rather than recalculating. Be direct and specific; no generic filler. This is
decision support, not financial advice."""


def _review_prompt(ticker: str, facts: dict[str, Any], headlines: list[str], lang: str) -> str:
    language = "Ukrainian" if lang == "uk" else "English"
    news = "\n".join(f"- {h}" for h in headlines) or "(no recent headlines)"
    return f"""Should this investor buy {ticker} today?

## Data (JSON)
{json.dumps(facts, ensure_ascii=False, indent=1, default=str)}

## Recent headlines
{news}

## Rules
- Write every text field in {language}; keep tickers as they are.
- Quote figures exactly as they appear in the data (e.g. "$564.00", "+10.6%"); don't round or restate them.
- Never show data field names; say "your strong-buy level", "your may-buy level", "your target weight".
- verdict:
  buy = the business is sound, the price is within the investor's levels and there is room and cash;
  buy_partial = buy only part now (a may-buy rather than strong-buy price, little room or cash, or earnings close);
  wait_price = a good business, but today's price is above the investor's levels (name the price to wait for);
  no_room = fine business and price, but the portfolio has no room for more;
  avoid = the business or the risk is the problem, whatever the price.
- Use `fit` for the price and room checks and don't contradict it. If the investor has no buy levels or the
  room is unknown, say what's missing and judge the price from the valuation alone.
- When cash is $0.00 and a buy makes sense, say it's for the next deposit.
- action: use the most they can buy now from `fit` as the ceiling; never suggest more.
- For a fund, judge its holdings' theme, cost and fit instead of company financials.
- Reported figures are dated by the last day of the period; recent news may be newer than them.
- If broker_data_unavailable is true, the broker didn't answer and the account figures are an older saved copy: say so in
  the portfolio_check and be careful with anything that depends on current cash or positions."""


async def _build_review(
    llm: LLMClient,
    conn: Connection,
    user: UserResponse,
    sym: str,
    lang: str,
    source_for: BrokerSource,
) -> dict[str, Any]:
    detail = await run_in_threadpool(fetch_detail, sym)
    fit = await run_in_threadpool(_stock_fit, conn, user, sym, detail, source_for)
    facts, _ = await run_in_threadpool(_gather, conn, user, sym, source_for, fit.weight)
    if detail:
        facts["company"] = _company_facts(detail)
    facts["fit"] = _fit_facts(fit)
    facts["broker_data_unavailable"] = facts["broker_data_unavailable"] or fit.stale_data or None
    news = await run_in_threadpool(get_news, ticker=sym, user=user)
    headlines = [f"{(n.published or '')[:10]} {n.title}".strip() for n in news.items[:8]]
    result = await _run(
        llm,
        _review_prompt(sym, facts, headlines, lang),
        StockReview,
        label=f"{sym} review",
        context={"lang": lang, "zone": fit.zone, "room": fit.room},
        system=_REVIEW_SYSTEM,
    )
    return {"ticker": sym, "review": result.value.model_dump(), "model": result.model, "lang": lang, "fit": fit.model_dump()}


@router.get("/{ticker}/fit", response_model=StockFit)
def get_stock_fit(
    ticker: Annotated[str, _TICKER],
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    source_for: Annotated[BrokerSource, Depends(get_broker_source)],
):
    sym = ticker.upper()
    return _stock_fit(conn, user, sym, fetch_detail(sym), source_for)


@router.get("/{ticker}/review", response_model=StockReviewResponse | None)
def get_stock_review(
    ticker: Annotated[str, _TICKER],
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """The last saved review for the stock page, or null."""
    saved = _load(conn, user.id, _review_key(ticker.upper()))
    if not saved:
        return None
    try:
        return StockReviewResponse(**saved[0], created_at=saved[1])
    except Exception:  # stored with an older shape
        return None


@router.post("/{ticker}/review", response_model=StockReviewResponse)
async def review_stock(
    ticker: Annotated[str, _TICKER],
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    source_for: Annotated[BrokerSource, Depends(get_broker_source)],
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    sym = ticker.upper()
    data = await _build_review(llm, conn, user, sym, lang, source_for)
    created_at = await run_in_threadpool(_save, conn, user.id, _review_key(sym), data)
    return StockReviewResponse(**data, created_at=created_at)


# ---- One ticker (declared after /portfolio, which this path pattern would also match) ----


@router.get("/{ticker}", response_model=AnalysisResponse | None)
def get_analysis(
    ticker: Annotated[str, _TICKER],
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """The last saved analysis for the ticker, or null."""
    saved = _load(conn, user.id, ticker.upper())
    if not saved:
        return None
    try:
        return AnalysisResponse(**saved[0], created_at=saved[1])
    except Exception:  # stored with an older shape
        return None


@router.post("/{ticker}", response_model=AnalysisResponse)
async def analyze(
    ticker: Annotated[str, _TICKER],
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    source_for: Annotated[BrokerSource, Depends(get_broker_source)],
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
    weight: Annotated[float | None, Query(ge=0, le=100, description="Your current portfolio weight, %")] = None,
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    sym = ticker.upper()
    facts, price = await run_in_threadpool(_gather, conn, user, sym, source_for, weight)
    news = await run_in_threadpool(get_news, ticker=sym, user=user)
    headlines = [f"{(n.published or '')[:10]} {n.title}".strip() for n in news.items[:8]]
    result = await _run(llm, _prompt(facts, headlines, lang), StockAnalysis, label=sym, context={"lang": lang}, system=_SYSTEM)
    data = {
        "ticker": sym,
        "analysis": result.value.model_dump(),
        "model": result.model,
        "lang": lang,
        "price": price,
        "stale_data": bool(facts["broker_data_unavailable"]),
    }
    created_at = await run_in_threadpool(_save, conn, user.id, sym, data)
    return AnalysisResponse(**data, created_at=created_at)
