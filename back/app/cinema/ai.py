"""AI picks with Gemini: a read of your taste from your scores, and titles you haven't seen that fit it.

Each pick is matched on TMDB (poster, IMDb rating, ids to add it in one click); picks that turn out to
be in your library already are dropped. The latest answer is saved, so it's there when you come back."""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from pydantic import BaseModel, Field, ValidationInfo, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse
from app.cinema.router import _best_match, _language, get_tmdb_key
from app.cinema.schemas import CinemaData, CinemaKind, CinemaTitle
from app.investing.analysis import StockAnalysis, _load, _run, _save, get_llm
from app.llm.client import LLMClient

router = APIRouter(prefix="/cinema/ai", tags=["cinema"])

# Stored in investing_ai_analyses next to the portfolio review; "@" can't start a ticker.
_KEY = "@CINEMA"

_KIND_NAMES = {
    "film": "film",
    "tv": "live-action series",
    "cartoon": "animated film",
    "animated_series": "animated series",
    "anime": "anime",
    "show": "TV show (reality, talk, game)",
}


# The same kind of title in the other TMDB catalogue (movie <-> tv).
_OTHER_CATALOGUE: dict[str, CinemaKind] = {
    "film": "tv",
    "tv": "film",
    "cartoon": "animated_series",
    "animated_series": "cartoon",
    "anime": "cartoon",
    "show": "film",
}


def _norm(s: str) -> str:
    return re.sub(r"[\W_]+", "", s.lower())


class CinemaPick(BaseModel):
    title: str = Field(description="The title's original or best-known English name, exactly as on TMDB/IMDb.")
    year: int = Field(description="Release year (first air year for series).")
    kind: CinemaKind = Field(description="film, tv (live-action series), cartoon (animated film), animated_series, anime or show.")
    reason: str = Field(description="1-2 sentences: why this fits, naming titles from the library it resembles.")

    @field_validator("title", "reason")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        return StockAnalysis._not_blank(v)

    @field_validator("reason")
    @classmethod
    def _language(cls, v: str, info: ValidationInfo) -> str:
        return StockAnalysis._language(v, info)


class CinemaTaste(BaseModel):
    """What Gemini returns, and what's stored."""

    headline: str = Field(description="One sentence that sums up this viewer's taste.")
    taste: str = Field(description="3-4 sentences: what they love, what they score low, how picky they are.")
    vs_crowd: str = Field(description="1-2 sentences on how their scores differ from IMDb, using the figures given.")
    patterns: list[str] = Field(description="2-4 short observations (genres, eras, directors, what they drop).")
    picks: list[CinemaPick] = Field(description="10-12 titles they have not seen, best fit first, mixing kinds they watch.")

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
    def _picks(cls, v: list[CinemaPick]) -> list[CinemaPick]:
        if not 4 <= len(v) <= 14:
            raise ValueError("give 10-12 picks")
        return v


class CinemaPickMatch(BaseModel):
    """A pick as found on TMDB; empty ids when TMDB had no match."""

    tmdb_id: int | None = None
    tmdb_media: Literal["movie", "tv", ""] = ""
    title: str = ""  # in the library's language
    original_title: str = ""
    year: int | None = None
    poster: str = ""
    overview: str = ""
    imdb_rating: float | None = None
    genres: list[str] = Field(default_factory=list)


class CinemaTasteResponse(BaseModel):
    analysis: CinemaTaste
    matches: list[CinemaPickMatch]  # same order as analysis.picks
    model: str
    lang: str
    titles: int  # library size when the picks were made
    created_at: str


_SYSTEM = """You are a film and TV critic who knows this viewer's history. You read their own scores (0-10)
and recommend specific, real titles they haven't seen. Prefer well-regarded titles that match the patterns in
their highest scores, avoid what they score low or drop, and explain each pick by naming titles they loved."""


def _brief(t: CinemaTitle) -> dict[str, Any]:
    return {
        k: v
        for k, v in {
            "title": t.original_title or t.title,
            "year": t.year,
            "kind": _KIND_NAMES.get(t.kind, t.kind),
            "score": t.score,
            "imdb": t.imdb_rating,
            "genres": t.genres[:3],
            "directors": t.directors[:2],
        }.items()
        if v not in (None, [], "")
    }


def _gather(items: list[CinemaTitle]) -> dict[str, Any]:
    scored = sorted((t for t in items if t.score is not None and t.status != "planned"), key=lambda t: -(t.score or 0))
    genre: dict[str, list[float]] = defaultdict(list)
    director: dict[str, list[float]] = defaultdict(list)
    for t in scored:
        for g in t.genres:
            genre[g].append(t.score or 0)
        for d in t.directors:
            director[d].append(t.score or 0)
    pairs = [(t.score or 0) - (t.imdb_rating or 0) for t in scored if t.imdb_rating]

    def avg(rows: dict[str, list[float]], min_n: int) -> dict[str, str]:
        ranked = sorted(((k, sum(v) / len(v), len(v)) for k, v in rows.items() if len(v) >= min_n), key=lambda r: -r[1])
        return {k: f"{a:.1f} ({n} titles)" for k, a, n in ranked[:12]}

    return {
        "titles_in_library": len(items),
        "kinds_watched": dict(Counter(_KIND_NAMES.get(t.kind, t.kind) for t in items if t.status != "planned").most_common()),
        "average_score": f"{sum(t.score or 0 for t in scored) / len(scored):.1f}" if scored else None,
        "vs_imdb": f"{sum(pairs) / len(pairs):+.1f} points on average over {len(pairs)} titles" if pairs else None,
        "favourites": [_brief(t) for t in scored[:40]],
        "lowest_scored": [_brief(t) for t in scored[-15:] if (t.score or 0) < 6],
        "dropped": [_brief(t) for t in items if t.status == "dropped"][:15],
        "recommended_by_viewer": [t.original_title or t.title for t in items if t.recommended][:30],
        "genre_average_score": avg(genre, 3),
        "director_average_score": avg(director, 2),
        "plan_to_watch": [t.original_title or t.title for t in items if t.status == "planned"][:40],
    }


def _prompt(facts: dict[str, Any], seen: list[str], lang: str) -> str:
    language = "Ukrainian" if lang == "uk" else "English"
    return f"""Read this viewer's taste and recommend what to watch next.

## Their history (JSON)
{json.dumps(facts, ensure_ascii=False, indent=1, default=str)}

## Already in their library: never recommend these
{"; ".join(seen)}

## Rules
- Write every text field in {language}. Keep `title` as the original or English name so it can be found on TMDB.
- Recommend real, released titles only, with the correct release year.
- Mix the kinds they actually watch, weighted by how much they watch each; don't recommend kinds they never watch.
- Don't recommend anything from their plan-to-watch list or library.
- In `reason`, name one or two titles from their favourites that the pick resembles.
- Quote figures exactly as given (e.g. "+0.4 points"); never show data field names."""


def _match(key: str, language: str, picks: list[CinemaPick], items: list[CinemaTitle]) -> list[CinemaPickMatch | None]:
    """TMDB match per pick, in order; None for a pick that is in the library already."""
    owned = {(t.tmdb_media, t.tmdb_id) for t in items if t.tmdb_id}

    def one(p: CinemaPick) -> CinemaPickMatch | None:
        d = None
        # Anime films and animated series get mixed up with the TMDB catalogue they live in: try the other one too.
        for kind in (p.kind, _OTHER_CATALOGUE[p.kind]):
            try:
                d = _best_match(key, language, p.title, kind, p.year) if key else None
            except HTTPException:
                d = None
            if d is not None:
                break
        if d is not None and (d.tmdb_media, d.tmdb_id) in owned:
            return None
        if d is None:
            return CinemaPickMatch(title=p.title, year=p.year)
        return CinemaPickMatch(
            tmdb_id=d.tmdb_id,
            tmdb_media=d.tmdb_media,
            title=d.title,
            original_title=d.original_title,
            year=d.year,
            poster=d.poster,
            overview=d.overview,
            imdb_rating=d.imdb_rating,
            genres=d.genres[:3],
        )

    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(one, picks))


@router.get("", response_model=CinemaTasteResponse | None)
def get_picks(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """The last saved taste read and picks, or null."""
    saved = _load(conn, user.id, _KEY)
    if not saved:
        return None
    try:
        return CinemaTasteResponse(**saved[0], created_at=saved[1])
    except Exception:  # stored with an older shape
        return None


@router.post("", response_model=CinemaTasteResponse)
async def make_picks(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
    lang: Annotated[Literal["en", "uk"], Query()] = "en",
):
    if llm is None:
        raise HTTPException(status_code=503, detail="AI analysis is not configured: set GEMINI_API_KEY in back/.env")
    row = await run_in_threadpool(lambda: conn.execute("SELECT data FROM cinema_titles WHERE user_id = %s", (user.id,)).fetchone())
    items = CinemaData(**(row[0] if row and isinstance(row[0], dict) else {})).items
    if sum(1 for t in items if t.score is not None) < 5:
        raise HTTPException(status_code=400, detail="Score at least 5 titles first, so there's a taste to read.")
    seen_names = list(dict.fromkeys(n for t in items for n in (t.original_title, t.title) if n))
    result = await _run(
        llm,
        _prompt(_gather(items), seen_names, lang),
        CinemaTaste,
        label="cinema",
        context={"lang": lang},
        system=_SYSTEM,
    )
    # Models still slip in titles the viewer has seen: drop those by name here, and by TMDB id in _match.
    seen = {_norm(n) for n in seen_names}
    analysis = result.value.model_copy(update={"picks": [p for p in result.value.picks if _norm(p.title) not in seen]})
    language = await run_in_threadpool(_language, conn, user.id)
    matches = await run_in_threadpool(_match, tmdb_key, language, analysis.picks, items)
    kept = [(p, m) for p, m in zip(analysis.picks, matches) if m is not None]
    analysis = analysis.model_copy(update={"picks": [p for p, _ in kept]})
    data = {
        "analysis": analysis.model_dump(),
        "matches": [m.model_dump() for _, m in kept],
        "model": result.model,
        "lang": lang,
        "titles": len(items),
    }
    created_at = await run_in_threadpool(_save, conn, user.id, _KEY, data)
    return CinemaTasteResponse(**data, created_at=created_at)
