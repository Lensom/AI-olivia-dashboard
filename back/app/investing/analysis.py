"""AI analysis with Gemini, for one ticker and for the whole portfolio.

Ticker: everything you entered about it (buy zones, price goals, notes, position, trades) plus market
data (Finviz snapshot, Yahoo headlines). Portfolio: every holding at live prices, cash, deposits,
realized gains, dividends, target weights and the watchlist buy zones. Both return a structured,
validated answer; the latest of each is saved, so it's there when you come back."""

from __future__ import annotations

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
from pydantic import BaseModel, Field, ValidationInfo, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse
from app.investing.router import (
    _broker_response,
    _calc_activity_yearly_summary,
    _enrich_activities_with_usd,
    _enrich_picking_rows,
    _normalize_stored_picking_row,
    _parse_num,
    get_rates,
)
from app.investing.schemas import InvestingBrokerData
from app.investing.watchlist import _fetch_snapshot, get_news
from app.llm.client import AllModelsFailedError, LLMClient, StructuredResult

T = TypeVar("T", bound=BaseModel)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/investing/analysis", tags=["investing"])

Verdict = Literal["strong_buy", "buy", "hold", "wait", "trim", "avoid"]
Confidence = Literal["low", "medium", "high"]

_NOTES_LIMIT = 3000  # general investing notes sent as context, characters
_TICKER = Path(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9.\-^=]+$")


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


def _gather(conn: Connection, user_id: int, ticker: str, weight: float | None = None) -> tuple[dict[str, Any], float | None]:
    """Everything known about the ticker (with the arithmetic done here rather than by the model), and today's price."""
    picking = conn.execute("SELECT rows FROM investing_picking WHERE user_id = %s", (user_id,)).fetchone()
    rows = [_normalize_stored_picking_row(r) for r in (picking[0] if picking and isinstance(picking[0], list) else []) if isinstance(r, dict)]
    row = next((r for r in rows if r["ticker"].strip().upper() == ticker), None)

    holdings = conn.execute("SELECT holdings FROM investing_holdings WHERE user_id = %s", (user_id,)).fetchone()
    holding = next(
        (h for h in (holdings[0] if holdings and isinstance(holdings[0], list) else []) if str(h.get("ticker", "")).strip().upper() == ticker),
        None,
    )
    if row is None and holding is None:
        raise HTTPException(status_code=404, detail="Ticker is not in your watchlist or portfolio")

    acts = conn.execute("SELECT activities FROM investing_activities WHERE user_id = %s", (user_id,)).fetchone()
    trades = [
        a for a in (acts[0] if acts and isinstance(acts[0], list) else [])
        if isinstance(a, dict) and str(a.get("ticker", "")).strip().upper() == ticker and a.get("type") in ("buy", "sell")
    ]
    trades.sort(key=lambda a: str(a.get("date", "")))
    notes = conn.execute("SELECT notes FROM investing_notes WHERE user_id = %s", (user_id,)).fetchone()

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
- If the investor owns it, take the position and target weight into account in `action`."""


# ---- Shared: run, save, load ----


async def _run(llm: LLMClient | None, prompt: str, schema: type[T], *, label: str, context: dict[str, Any], system: str) -> StructuredResult[T]:
    """One Gemini call with the errors turned into messages the page can show."""
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    try:
        return await llm.structured(prompt, schema, context=context, system_instruction=system)
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


class PortfolioAnalysisResponse(BaseModel):
    analysis: PortfolioAnalysis
    model: str
    lang: str
    account_value: float | None = None  # positions + cash when the review was made
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


def _gather_portfolio(conn: Connection, user: UserResponse) -> tuple[dict[str, Any], float, set[str]]:
    """The whole account at live prices, with every ratio worked out here. Returns (facts, account value, known tickers)."""
    stored = conn.execute("SELECT holdings FROM investing_holdings WHERE user_id = %s", (user.id,)).fetchone()
    holdings = [
        h for h in (stored[0] if stored and isinstance(stored[0], list) else [])
        if isinstance(h, dict) and str(h.get("ticker", "")).strip() and float(h.get("shares") or 0) > 0
    ]
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

    broker_row = conn.execute("SELECT data FROM investing_broker WHERE user_id = %s", (user.id,)).fetchone()
    broker = _broker_response(InvestingBrokerData(**(broker_row[0] if broker_row and isinstance(broker_row[0], dict) else {})), None)
    to_usd = get_rates(user=user).to_usd
    cash = sum(_parse_num(c.amount) * to_usd.get((c.currency or "USD").strip().upper(), 0.0) for c in broker.cash)
    year_ago = datetime.now().timestamp() - 365 * 86400
    dividends_12m = sum(d.amount_usd for d in broker.dividends if (ts := _dmy_ts(d.date)) and ts >= year_ago)

    refills = conn.execute("SELECT rows FROM investing_refills WHERE user_id = %s", (user.id,)).fetchone()
    deposited = sum(
        _parse_num(str(r.get("amount", ""))) for r in (refills[0] if refills and isinstance(refills[0], list) else []) if isinstance(r, dict)
    )

    acts = conn.execute("SELECT activities FROM investing_activities WHERE user_id = %s", (user.id,)).fetchone()
    try:
        summary = _calc_activity_yearly_summary(_enrich_activities_with_usd(acts[0] if acts and isinstance(acts[0], list) else []))
    except Exception:  # malformed legacy rows: leave the history out rather than fail
        summary = []
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
            "today": _signed_usd(day_move),
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
    }
    return facts, account, set(tickers)


_PORTFOLIO_SYSTEM = """You are a careful portfolio analyst reviewing the whole brokerage account of one
private long-term investor. Judge it as a portfolio — diversification, concentration, drift from
the investor's own target weights, valuation, income, risk and how the cash is used — not stock by
stock. Use only the data given: when something is missing, say so instead of guessing, and never
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
  are in a buy zone, with their prices; if nothing is in a buy zone, say what to wait for."""


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
        return PortfolioAnalysisResponse(**saved[0], created_at=saved[1])
    except Exception:  # stored with an older shape
        return None


@router.post("/portfolio", response_model=PortfolioAnalysisResponse)
async def analyze_portfolio(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    facts, account, tickers = await run_in_threadpool(_gather_portfolio, conn, user)
    result = await _run(
        llm,
        _portfolio_prompt(facts, lang),
        PortfolioAnalysis,
        label="portfolio",
        context={"lang": lang, "tickers": tickers},
        system=_PORTFOLIO_SYSTEM,
    )
    data = {"analysis": result.value.model_dump(), "model": result.model, "lang": lang, "account_value": round(account, 2)}
    created_at = await run_in_threadpool(_save, conn, user.id, _PORTFOLIO_KEY, data)
    return PortfolioAnalysisResponse(**data, created_at=created_at)


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
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
    weight: Annotated[float | None, Query(ge=0, le=100, description="Your current portfolio weight, %")] = None,
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    sym = ticker.upper()
    facts, price = await run_in_threadpool(_gather, conn, user.id, sym, weight)
    news = await run_in_threadpool(get_news, ticker=sym, user=user)
    headlines = [f"{(n.published or '')[:10]} {n.title}".strip() for n in news.items[:8]]
    result = await _run(llm, _prompt(facts, headlines, lang), StockAnalysis, label=sym, context={"lang": lang}, system=_SYSTEM)
    data = {"ticker": sym, "analysis": result.value.model_dump(), "model": result.model, "lang": lang, "price": price}
    created_at = await run_in_threadpool(_save, conn, user.id, sym, data)
    return AnalysisResponse(**data, created_at=created_at)
