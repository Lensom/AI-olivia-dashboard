"""Book series from Wikidata ("part of the series", P179): which series each book belongs to, and every
book of those series, so the Series page can show your progress through them like Cinema's franchises."""

from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.router import get_current_user
from app.auth.schemas import UserResponse
from app.library import wikidata as wd
from app.library.router import _get_json, _norm
from app.library.schemas import LibrarySeries, LibrarySeriesPart, LibraryWikidata, LibraryWikidataRequest

router = APIRouter(prefix="/library", tags=["library"])
logger = logging.getLogger(__name__)

_TTL = 7 * 24 * 60 * 60
_MAX_PARTS = 100  # bigger "series" are bibliographies or whole universes, not something to complete
_series_cache: dict[tuple[str, str], tuple[float, LibrarySeries | None]] = {}


def _ordinal(entity: dict, series_id: str) -> str:
    """The book's number in this series (P1545 on its P179 claim), e.g. "3"."""
    for c in (entity.get("claims") or {}).get("P179", []):
        v = (c.get("mainsnak") or {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and v.get("id") == series_id:
            for q in (c.get("qualifiers") or {}).get("P1545", []):
                if isinstance(n := (q.get("datavalue") or {}).get("value"), str):
                    return n
    return ""


def _year(entity: dict) -> int | None:
    for c in (entity.get("claims") or {}).get("P577", []):
        v = (c.get("mainsnak") or {}).get("datavalue", {}).get("value")
        if isinstance(v, dict) and (m := re.match(r"[+-](\d{4})", v.get("time") or "")):
            return int(m.group(1))
    return None


def _ol_work(entity: dict) -> str:
    return next((f"/works/{w}" for w in wd.claim_strings(entity, "P648") if re.fullmatch(r"OL\d+W", w)), "")


def _ol_cover(work: str) -> str:
    if not work:
        return ""
    try:
        covers = [c for c in _get_json(f"https://openlibrary.org{work}.json").get("covers") or [] if isinstance(c, int) and c > 0]
    except HTTPException:
        return ""
    return f"https://covers.openlibrary.org/b/id/{covers[0]}-M.jpg" if covers else ""


def _series_size(series_id: str) -> int:
    return wd.search_statement(f"P179={series_id}", limit=1)[1]


def _lookup(items: list[LibraryWikidataRequest], lang: str) -> list[LibraryWikidata]:
    # 1. The book's entity: by its Open Library work (exact), else by title.
    ol = {t.id: t.source_id.rsplit("/", 1)[-1] for t in items if t.source == "openlibrary" and t.source_id}
    by_ol = wd.by_open_library(list(ol.values()))
    qids: dict[str, str] = {}
    for t in items:
        if ol.get(t.id) in by_ol:
            qids[t.id] = by_ol[ol[t.id]]
            continue
        for title, language in ((t.original_title, "en"), (t.title, "uk")):
            try:
                q = wd.find_book(title, language) if title else None
            except HTTPException:
                q = None
            if q:
                qids[t.id] = q
                break

    # 2. Its series; a book in several (a cycle and a whole bibliography) goes with the smallest real one.
    books = wd.entities(list(qids.values()), props="claims")
    candidates = {q: wd.claim_ids(e, "P179") for q, e in books.items()}
    sizes = {s: _series_size(s) for s in {s for ss in candidates.values() for s in ss}}
    best: dict[str, str] = {}
    for q, ss in candidates.items():
        fits = sorted((sizes[s], s) for s in ss if 2 <= sizes[s] <= _MAX_PARTS)
        if fits:
            best[q] = fits[0][1]
    names = {s: wd.label(e, lang, "en") for s, e in wd.entities(list(set(best.values())), props="labels").items()}

    out = []
    for t in items:
        q = qids.get(t.id, "")
        s = best.get(q, "")
        out.append(LibraryWikidata(id=t.id, wikidata_id=q, series_id=s if names.get(s) else "", series_name=names.get(s, "")))
    return out


def _series(series_id: str, lang: str) -> LibrarySeries | None:
    hit = _series_cache.get((series_id, lang))
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    members, total = wd.search_statement(f"P179={series_id}", limit=_MAX_PARTS)
    name = wd.label(wd.entities([series_id], props="labels").get(series_id, {}), lang, "en")
    result: LibrarySeries | None = None
    if name and 2 <= total <= _MAX_PARTS:
        rows: list[tuple[LibrarySeriesPart, str]] = []
        for qid, e in wd.entities(members).items():
            authors = wd.claim_ids(e, "P50")
            title = wd.label(e, lang, "en")
            if not authors or not title:  # written works have an author; films, games and stubs don't
                continue
            part = LibrarySeriesPart(
                wikidata_id=qid,
                title=title,
                original_title=wd.label(e, "en"),
                year=_year(e),
                index=_ordinal(e, series_id),
                ol_id=_ol_work(e),
            )
            rows.append((part, authors[0]))
        # A numbered series (Harry Potter 1–7) keeps the numbered books only: prequels, plays and
        # companion pieces are listed too but aren't part of reading it.
        numbered = [r for r in rows if r[0].index.isdigit() and int(r[0].index) >= 1]
        is_numbered = len(numbered) >= max(2, len(rows) / 2)
        if is_numbered:
            rows = numbered
        seen: set[str] = set()
        unique = []
        for part, author in sorted(rows, key=lambda r: (not r[0].ol_id, r[0].year or 9999)):
            key = _norm(part.original_title or part.title)
            if key not in seen:
                seen.add(key)
                unique.append((part, author))
        people = wd.entities(list({a for _, a in unique}), props="labels", languages=f"{lang}|en")
        with ThreadPoolExecutor(max_workers=4) as pool:
            covers = list(pool.map(lambda r: _ol_cover(r[0].ol_id), unique))
        parts = [
            part.model_copy(update={"author": wd.label(people.get(a, {}), lang, "en"), "cover": cover})
            for (part, a), cover in zip(unique, covers)
        ]
        # Reading order: by number in a numbered series, else by publication (a lone number means little).
        parts.sort(key=lambda p: (int(p.index) if is_numbered and p.index.isdigit() else 0, p.year or 9999, p.title))
        if len(parts) >= 2:
            result = LibrarySeries(id=series_id, name=name, parts=parts)
    _series_cache[(series_id, lang)] = (time.time(), result)
    return result


@router.post("/wikidata", response_model=list[LibraryWikidata])
def lookup_wikidata(
    payload: list[LibraryWikidataRequest],
    user: Annotated[UserResponse, Depends(get_current_user)],
    lang: Annotated[Literal["en", "uk"], Query()] = "uk",
):
    """Wikidata entity and series for up to 40 books, in the same order."""
    try:
        return _lookup(payload[:40], lang)
    except HTTPException:
        raise HTTPException(status_code=502, detail="Wikidata is busy — try again in a minute.") from None


@router.post("/series", response_model=list[LibrarySeries])
def series_parts(
    payload: list[str],
    user: Annotated[UserResponse, Depends(get_current_user)],
    lang: Annotated[Literal["en", "uk"], Query()] = "uk",
):
    """Every book of up to 40 series, in reading order; series Wikidata can't list are left out."""
    out = []
    for sid in dict.fromkeys(s for s in payload[:40] if re.fullmatch(r"Q\d+", s)):
        try:
            if s := _series(sid, lang):
                out.append(s)
        except HTTPException as exc:
            logger.warning("Series %s: %s", sid, exc.detail)  # not cached: tried again next time
            continue
    return out
