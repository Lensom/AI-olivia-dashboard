"""AI picks for the Library with Gemini: a read of your reading taste from your scores, and books you
haven't read that fit it. Each pick is matched on Open Library / Google Books (cover, pages, readers' rating)
so it can be added in one click; picks already in your library are dropped. The latest answer is saved."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from pydantic import BaseModel, Field, ValidationInfo, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse
from app.investing.analysis import StockAnalysis, _load, _run, _save, get_llm
from app.library.router import _best_match, _norm, get_google_books_key
from app.library.schemas import LibraryData, LibraryDetails, LibraryItem
from app.llm.client import LLMClient

router = APIRouter(prefix="/library/ai", tags=["library"])

# Stored in investing_ai_analyses next to the portfolio review; "@" can't start a ticker.
_KEY = "@LIBRARY"


class BookPick(BaseModel):
    title: str = Field(description="The book's original title, or its best-known English title, as Open Library lists it.")
    author: str = Field(description="Author's name in Latin script.")
    year: int = Field(description="Year first published.")
    reason: str = Field(description="1-2 sentences: why this fits, naming books from the library it resembles.")

    @field_validator("title", "author", "reason")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        return StockAnalysis._not_blank(v)

    @field_validator("reason")
    @classmethod
    def _language(cls, v: str, info: ValidationInfo) -> str:
        return StockAnalysis._language(v, info)


class ReadingTaste(BaseModel):
    """What Gemini returns, and what's stored."""

    headline: str = Field(description="One sentence that sums up this reader's taste.")
    taste: str = Field(description="3-4 sentences: what they love, what they score low, fiction vs non-fiction, how picky they are.")
    vs_crowd: str = Field(description="1-2 sentences on how their scores differ from other readers' averages, using the figures given.")
    patterns: list[str] = Field(description="2-4 short observations (genres, authors, eras, book length, what they drop).")
    picks: list[BookPick] = Field(description="10-12 books they have not read, best fit first.")

    @field_validator("headline", "taste", "vs_crowd")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        return StockAnalysis._not_blank(v)

    @field_validator("headline", "taste")
    @classmethod
    def _language(cls, v: str, info: ValidationInfo) -> str:
        return StockAnalysis._language(v, info)

    @field_validator("patterns")
    @classmethod
    def _bullets(cls, v: list[str]) -> list[str]:
        return StockAnalysis._bullets(v)

    @field_validator("picks")
    @classmethod
    def _picks(cls, v: list[BookPick]) -> list[BookPick]:
        if not 4 <= len(v) <= 14:
            raise ValueError("give 10-12 picks")
        return v


class ReadingTasteResponse(BaseModel):
    analysis: ReadingTaste
    matches: list[LibraryDetails | None]  # same order as analysis.picks; None when no catalogue had it
    model: str
    lang: str
    titles: int  # library size when the picks were made
    created_at: str


_SYSTEM = """You are a well-read bookseller who knows this reader's history. You read their own scores (1-5 stars)
and recommend specific, real books they haven't read. Prefer well-regarded books that match the patterns in
their highest scores, avoid what they score low or drop, and explain each pick by naming books they loved."""


def _brief(t: LibraryItem) -> dict[str, Any]:
    return {
        k: v
        for k, v in {
            "title": t.original_title or t.title,
            "authors": t.authors[:2],
            "kind": t.kind,
            "score": t.score,
            "readers_avg": t.source_rating,
            "genres": t.genres[:3],
            "published": t.year,
            "pages": t.pages,
        }.items()
        if v not in (None, [], "")
    }


def _gather(items: list[LibraryItem]) -> dict[str, Any]:
    scored = sorted((t for t in items if t.score is not None and t.status != "planned"), key=lambda t: -(t.score or 0))
    genre: dict[str, list[float]] = defaultdict(list)
    author: dict[str, list[float]] = defaultdict(list)
    for t in scored:
        for g in t.genres:
            genre[g].append(t.score or 0)
        for a in t.authors[:1]:
            author[a].append(t.score or 0)
    pairs = [(t.score or 0) - (t.source_rating or 0) for t in scored if t.source_rating]

    def avg(rows: dict[str, list[float]], min_n: int) -> dict[str, str]:
        ranked = sorted(((k, sum(v) / len(v), len(v)) for k, v in rows.items() if len(v) >= min_n), key=lambda r: -r[1])
        return {k: f"{a:.1f} ({n} books)" for k, a, n in ranked[:12]}

    return {
        "books_in_library": len(items),
        "kinds_read": dict(Counter(t.kind for t in items if t.status != "planned").most_common()),
        "average_score": f"{sum(t.score or 0 for t in scored) / len(scored):.1f} of 5" if scored else None,
        "vs_readers": f"{sum(pairs) / len(pairs):+.1f} stars on average over {len(pairs)} books" if pairs else None,
        "favourites": [_brief(t) for t in scored[:40]],
        "lowest_scored": [_brief(t) for t in scored[-12:] if (t.score or 0) <= 3],
        "dropped": [_brief(t) for t in items if t.status == "dropped"][:15],
        "recommended_by_reader": [t.original_title or t.title for t in items if t.recommended][:30],
        "genre_average_score": avg(genre, 2),
        "author_average_score": avg(author, 2),
        "want_to_read": [t.original_title or t.title for t in items if t.status == "planned"][:40],
    }


def _prompt(facts: dict[str, Any], seen: list[str], lang: str) -> str:
    language = "Ukrainian" if lang == "uk" else "English"
    return f"""Read this reader's taste and recommend what to read next.

## Their history (JSON)
{json.dumps(facts, ensure_ascii=False, indent=1, default=str)}

## Already in their library: never recommend these, in any language or edition
{"; ".join(seen)}

## Rules
- Write every text field in {language}. Keep `title` and `author` as the original or English names so they can be found on Open Library.
- Recommend real, published books only, with the correct first-publication year.
- Match the mix of fiction and non-fiction they actually read; don't recommend kinds they never read.
- Several books by one author they love are fine, but no more than two per author.
- In `reason`, name one or two books from their favourites that the pick resembles.
- Quote figures exactly as given (e.g. "+0.4 stars"); never show data field names."""


def _match(gkey: str, picks: list[BookPick], items: list[LibraryItem]) -> list[LibraryDetails | None | bool]:
    """Catalogue match per pick, in order; False for a pick that is in the library already."""
    owned_ids = {t.source_id for t in items if t.source_id}
    owned_names = {_norm(n) for t in items for n in (t.title, t.original_title) if n}

    def one(p: BookPick) -> LibraryDetails | None | bool:
        try:
            d = _best_match(gkey, p.title, [p.author], "book", _translated=True)
        except HTTPException:
            d = None
        if d is not None and (d.source_id in owned_ids or _norm(d.title) in owned_names):
            return False
        return d

    with ThreadPoolExecutor(max_workers=3) as pool:
        return list(pool.map(one, picks))


@router.get("", response_model=ReadingTasteResponse | None)
def get_picks(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """The last saved taste read and picks, or null."""
    saved = _load(conn, user.id, _KEY)
    if not saved:
        return None
    try:
        return ReadingTasteResponse(**saved[0], created_at=saved[1])
    except Exception:  # stored with an older shape
        return None


@router.post("", response_model=ReadingTasteResponse)
async def make_picks(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    gkey: Annotated[str, Depends(get_google_books_key)],
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    row = await run_in_threadpool(lambda: conn.execute("SELECT data FROM library_items WHERE user_id = %s", (user.id,)).fetchone())
    items = LibraryData(**(row[0] if row and isinstance(row[0], dict) else {})).items
    if sum(1 for t in items if t.score is not None) < 5:
        raise HTTPException(status_code=400, detail="Score at least 5 books first, so there's a taste to read.")
    seen_names = list(dict.fromkeys(n for t in items for n in (t.original_title, t.title) if n))
    result = await _run(
        llm,
        _prompt(_gather(items), seen_names, lang),
        ReadingTaste,
        label="library",
        context={"lang": lang},
        system=_SYSTEM,
    )
    # Models still slip in books the reader has read: drop those by name here, and by catalogue id in _match.
    seen = {_norm(n) for n in seen_names}
    picks = [p for p in result.value.picks if _norm(p.title) not in seen]
    matches = await run_in_threadpool(_match, gkey, picks, items)
    kept = [(p, m) for p, m in zip(picks, matches) if m is not False]
    analysis = result.value.model_copy(update={"picks": [p for p, _ in kept]})
    data = {
        "analysis": analysis.model_dump(),
        "matches": [m.model_dump() if m else None for _, m in kept],
        "model": result.model,
        "lang": lang,
        "titles": len(items),
    }
    created_at = await run_in_threadpool(_save, conn, user.id, _KEY, data)
    return ReadingTasteResponse(**data, created_at=created_at)
