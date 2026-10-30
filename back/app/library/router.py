from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from html import unescape
from typing import Annotated, Literal
import json
import re
import time
import uuid
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.auth.router import get_current_user, get_conn
from app.auth.schemas import UserResponse
from app.cinema.router import _FALSE, _TRUE, _cell, _list
from app.investing.analysis import _run, get_llm
from app.investing.router import _read_import_table
from app.library import wikidata
from app.library.schemas import (
    LibraryData,
    LibraryDetails,
    LibraryImportResponse,
    LibraryItem,
    LibraryKind,
    LibraryMatchRequest,
    LibraryResponse,
)
from app.llm.client import LLMClient


router = APIRouter(prefix="/library", tags=["library"])


def get_google_books_key() -> str:
    """Overridden in main.py with GOOGLE_BOOKS_API_KEY from settings (optional)."""
    return ""


_UA = "olivia-personal-dashboard/1.0"
_TTL = 60 * 60
_cache: dict[str, tuple[float, dict]] = {}


def _get_json(url: str, *, cache_key: str | None = None) -> dict:
    key = cache_key or url
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    # Open Library and Wikidata are often slow for a moment or throttle bursts: retry with a short pause.
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": _UA, "Accept": "application/json"}), timeout=15) as res:
                data = json.loads(res.read().decode("utf-8"))
            break
        except HTTPError as exc:
            if (exc.code < 500 and exc.code != 429) or attempt == 2:
                raise HTTPException(status_code=502, detail=f"Book search error {exc.code}.") from exc
        except (URLError, TimeoutError) as exc:
            if attempt == 2:
                raise HTTPException(status_code=502, detail="Could not reach the book catalogue.") from exc
        time.sleep(1.5 * (attempt + 1))
    _cache[key] = (time.time(), data)
    return data


def _year(value: object) -> int | None:
    m = re.search(r"(1[5-9]|20)\d{2}", str(value or ""))
    return int(m.group(0)) if m else None


def _clean_title(title: str) -> str:
    """Drop edition notes catalogues tack on: "Essentialism (Korean Edition)", "… [12 stories]"."""
    title = re.sub(r"\s*(\[[^\]]*\]|\([^)]*\bedition\)|\([^)]*\bвидання\))\s*$", "", title, flags=re.I)
    return title.strip().rstrip(" :;,/").strip() or title


def _clean_genres(subjects: list[str]) -> list[str]:
    # Open Library subjects mix genres with tags like "form:manga volume" or "New York Times bestseller".
    out: list[str] = []
    for s in subjects:
        s = s.strip()
        if not s or ":" in s or len(s) > 30 or re.search(r"\d|bestseller|reviewed|accessible|large type", s, re.I):
            continue
        name = s[:1].upper() + s[1:]
        if name.lower() not in {o.lower() for o in out}:
            out.append(name)
    return out[:3]


# --- Open Library -------------------------------------------------------------------------------

_OL_FIELDS = "key,title,subtitle,author_name,first_publish_year,cover_i,number_of_pages_median,subject,ratings_average,ratings_count,publisher,isbn,language"


def _ol_doc(d: dict, kind: str) -> LibraryDetails:
    subjects = d.get("subject") or []
    # Keep the format as a genre: it's how manga and comics are told apart from novels of the same name.
    # Only on the Comics / Manga pages: a novel with a graphic-novel edition shouldn't be tagged "Comics".
    form = next((f for f, w in (("Manga", "manga"), ("Comics", "comic"), ("Graphic novels", "graphic novel"))
                 if kind in ("manga", "comic") and any(w in x.lower() for x in subjects)), "")
    return LibraryDetails(
        source="openlibrary",
        source_id=d.get("key") or "",
        title=_clean_title(d.get("title") or ""),
        authors=(d.get("author_name") or [])[:3],
        year=d.get("first_publish_year"),
        pages=d.get("number_of_pages_median"),
        publisher=(d.get("publisher") or [""])[0],
        genres=([form] if form else []) + [g for g in _clean_genres(subjects) if g != form][: 3 if not form else 2],
        cover=f"https://covers.openlibrary.org/b/id/{d['cover_i']}-M.jpg" if d.get("cover_i") else "",
        isbn=next((i for i in d.get("isbn") or [] if len(i) == 13), ""),
        language=(d.get("language") or [""])[0],
        source_rating=round(float(d["ratings_average"]), 1) if d.get("ratings_average") else None,
        source_votes=d.get("ratings_count"),
    )


def _ol_search(q: str, kind: str, author: str = "") -> list[LibraryDetails]:
    # With an author it's a match ("title" + "author"); otherwise a free search, which Open Library
    # rejects for very short or common words ("It"), so that falls back to a title search.
    params: dict[str, object] = {"limit": 12, "fields": _OL_FIELDS}
    if author:
        params.update(title=q, author=author)
        data = _get_json(f"https://openlibrary.org/search.json?{urlencode(params)}")
    else:
        try:
            data = _get_json(f"https://openlibrary.org/search.json?{urlencode({**params, 'q': q})}")
        except HTTPException:
            data = _get_json(f"https://openlibrary.org/search.json?{urlencode({**params, 'title': q})}")
    return [_ol_doc(d, kind) for d in data.get("docs") or [] if d.get("title")]


def _clean_description(text: str) -> str:
    """Open Library descriptions are Markdown with link lists and footnotes: keep the prose."""
    text = re.split(r"\r?\n-{3,}|\r?\n\s*(?:Contains|See also)\s*:", text)[0]
    text = re.sub(r"^\s*\[\d+\]:\s*\S+.*$", "", text, flags=re.M)  # footnote targets
    text = re.sub(r"\(?\[source\]\[\d+\]\)?", "", text, flags=re.I)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)  # [text](url) → text
    text = re.sub(r"\[([^\]]+)\]\[\d+\]", r"\1", text)
    return re.sub(r"[ \t]+", " ", re.sub(r"(\r?\n\s*){3,}", "\n\n", text)).strip()


def _ol_details(key: str, kind: str = "book") -> LibraryDetails:
    docs = _get_json(f"https://openlibrary.org/search.json?{urlencode({'q': f'key:{key}', 'fields': _OL_FIELDS})}").get("docs") or []
    if not docs:
        raise HTTPException(status_code=404, detail="Not found on Open Library.")
    out = _ol_doc(docs[0], kind)
    work = _get_json(f"https://openlibrary.org{quote(key)}.json")
    desc = work.get("description")
    out.description = _clean_description(desc.get("value") if isinstance(desc, dict) else desc or "")
    if out.cover:
        out.cover = out.cover.replace("-M.jpg", "-L.jpg")
    return out


# --- Google Books (optional, better for Ukrainian editions) --------------------------------------


def _gb_volume(v: dict) -> LibraryDetails:
    info = v.get("volumeInfo") or {}
    img = (info.get("imageLinks") or {}).get("thumbnail") or (info.get("imageLinks") or {}).get("smallThumbnail") or ""
    desc = re.sub(r"<[^>]+>", " ", info.get("description") or "")
    return LibraryDetails(
        source="google",
        source_id=v.get("id") or "",
        title=_clean_title(info.get("title") or ""),
        authors=(info.get("authors") or [])[:3],
        year=_year(info.get("publishedDate")),
        pages=info.get("pageCount") or None,
        publisher=info.get("publisher") or "",
        genres=_clean_genres([c.split("/")[-1] for c in info.get("categories") or []]),
        cover=img.replace("http://", "https://").replace("&edge=curl", ""),
        description=re.sub(r"\s+", " ", unescape(desc)).strip(),
        isbn=next((i["identifier"] for i in info.get("industryIdentifiers") or [] if i.get("type") == "ISBN_13"), ""),
        language=info.get("language") or "",
        source_rating=info.get("averageRating"),
        source_votes=info.get("ratingsCount"),
    )


def _gb_search(key: str, q: str, kind: str, author: str = "") -> list[LibraryDetails]:
    query = f"intitle:{q}" + (f" inauthor:{author}" if author else "")
    params = {"q": query, "maxResults": 12, "printType": "magazines" if kind == "magazine" else "books", "key": key}
    url = f"https://www.googleapis.com/books/v1/volumes?{urlencode(params)}"
    data = _get_json(url, cache_key=url.replace(key, ""))
    return [_gb_volume(v) for v in data.get("items") or []]


def _gb_details(key: str, volume_id: str) -> LibraryDetails:
    url = f"https://www.googleapis.com/books/v1/volumes/{quote(volume_id)}?key={key}"
    return _gb_volume(_get_json(url, cache_key=url.replace(key, "")))


# --- Shared search / match ----------------------------------------------------------------------

_KIND_HINTS = {"manga": ("manga", "манга"), "comic": ("comic", "graphic novel", "комікс"), "magazine": ("magazine", "журнал")}


def _norm(s: str) -> str:
    return re.sub(r"[\W_]+", "", s.lower().replace("ґ", "г"))


def _search(gkey: str, q: str, kind: str, author: str = "") -> list[LibraryDetails]:
    results: list[LibraryDetails] = []
    errors = 0
    sources = ([lambda: _gb_search(gkey, q, kind, author)] if gkey else []) + [lambda: _ol_search(q, kind, author)]
    for fetch in sources:
        try:
            results += fetch()
        except HTTPException:
            errors += 1
    if errors == len(sources):
        raise HTTPException(status_code=502, detail="Could not reach the book catalogue.")
    # One entry per work: Google lists many editions of the same book.
    seen: set[str] = set()
    unique: list[LibraryDetails] = []
    for r in results:
        k = _norm(r.title) + _norm((r.authors or [""])[0])
        if k not in seen:
            seen.add(k)
            unique.append(r)
    hints = _KIND_HINTS.get(kind, ())
    return sorted(unique, key=lambda r: not any(h in " ".join(r.genres).lower() for h in hints))[:12]


def _wikidata_english(title: str) -> tuple[str, str] | None:
    """English title and author of a book known by its Ukrainian (or Russian) name, via Wikidata.
    Open Library lists works under their original names, so "Зелена миля" is found as "The Green Mile"."""
    try:
        qid = wikidata.find_book(title)
        return wikidata.english_title(qid) if qid else None
    except (HTTPException, KeyError, TypeError):
        return None


def _best_match(gkey: str, title: str, authors: list[str], kind: str, _translated: bool = False) -> LibraryDetails | None:
    author = authors[0] if authors else ""
    results = _search(gkey, title, kind, author) if author else []
    if not results:
        results = _search(gkey, title, kind)
    head = re.split(r"[.:]", title)[0].strip()
    if not results and head != title and len(head) >= 3:
        # "Sapiens. Краткая история человечества" → "Sapiens"
        title, results = head, _search(gkey, head, kind)
    found = _pick(gkey, results, title, author, kind) if results else None
    if not found and not _translated and re.search(r"[а-яіїєґё]", title, re.I):
        english = _wikidata_english(title)
        if english:
            return _best_match(gkey, english[0], [english[1]] if english[1] else [], kind, _translated=True)
    return found


_STUDY_AID = re.compile(r"cram101|study guide|summary of|summary &|textbook outlines?|workbook for|analysis of|sparknotes|cliffsnotes", re.I)


def _pick(gkey: str, results: list[LibraryDetails], title: str, author: str, kind: str) -> LibraryDetails | None:
    want = _norm(title)
    surname = _norm(author.split()[-1]) if author.split() else ""

    hints = _KIND_HINTS.get(kind, ())

    def fit(r: LibraryDetails) -> tuple:
        exact = want in (_norm(r.title), _norm(r.original_title))
        return (
            any(h in " ".join(r.genres).lower() for h in hints),  # manga / comics / magazines: the right format first
            exact,
            exact or _norm(r.title).startswith(want),
            bool(surname) and any(surname in _norm(a) for a in r.authors),
            bool(r.cover),
            r.source_votes or 0,
        )

    # Study guides and summaries carry the book's title and author too ("Cram101 … Flow"): never pick them.
    results = [r for r in results if not _STUDY_AID.search(r.title)]
    if not results:
        return None
    best = max(results, key=fit)
    if not any(fit(best)[:4]):
        return None  # neither the title, the format nor the author fits: better no match than a wrong one
    return _details(gkey, best.source, best.source_id, kind) if best.source_id else best


def _details(gkey: str, source: str, source_id: str, kind: str = "book") -> LibraryDetails:
    if source == "google":
        if not gkey:
            raise HTTPException(status_code=503, detail="Google Books is not configured (GOOGLE_BOOKS_API_KEY).")
        return _gb_details(gkey, source_id)
    return _ol_details(source_id, kind)


# --- Storage ------------------------------------------------------------------------------------


@router.get("", response_model=LibraryResponse)
def get_library(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    gkey: Annotated[str, Depends(get_google_books_key)],
):
    row = conn.execute("SELECT data, updated_at FROM library_items WHERE user_id = %s", (user.id,)).fetchone()
    data = LibraryData(**(row[0] if row and isinstance(row[0], dict) else {}))
    return LibraryResponse(**data.model_dump(), updated_at=str(row[1]) if row else None, google_enabled=bool(gkey))


@router.put("", response_model=LibraryResponse)
def update_library(
    payload: LibraryData,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    gkey: Annotated[str, Depends(get_google_books_key)],
):
    data = payload.model_dump()
    if "lists" not in payload.model_fields_set:
        saved = conn.execute("SELECT data->'lists' FROM library_items WHERE user_id = %s", (user.id,)).fetchone()
        data["lists"] = saved[0] if saved and isinstance(saved[0], list) else []
    row = conn.execute(
        """
        INSERT INTO library_items(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(data)),
    ).fetchone()
    conn.commit()
    return LibraryResponse(**data, updated_at=str(row[0]) if row else None, google_enabled=bool(gkey))


@router.get("/search", response_model=list[LibraryDetails])
def search_books(
    user: Annotated[UserResponse, Depends(get_current_user)],
    gkey: Annotated[str, Depends(get_google_books_key)],
    q: str = Query(min_length=1, max_length=200),
    kind: LibraryKind = "book",
):
    return _search(gkey, q.strip(), kind)


@router.get("/details", response_model=LibraryDetails)
def book_details(
    user: Annotated[UserResponse, Depends(get_current_user)],
    gkey: Annotated[str, Depends(get_google_books_key)],
    source: Literal["openlibrary", "google"],
    source_id: str = Query(min_length=1, max_length=100),
    kind: LibraryKind = "book",
):
    return _details(gkey, source, source_id, kind)


class _Original(BaseModel):
    id: str
    title: str = Field(description="The work's original title, or its best-known English title, as Open Library lists it; empty if you don't know the book.")
    author: str = Field(description="First author in Latin script, as Open Library spells it; empty if unknown.")


class _Originals(BaseModel):
    books: list[_Original]


async def _originals(llm: LLMClient, items: list[LibraryMatchRequest]) -> dict[str, tuple[str, str]]:
    """Gemini's guess at the original title and author of translated editions; {} when it can't help."""
    rows = [{"id": t.id, "title": t.title, "authors": t.authors} for t in items]
    prompt = f"""These are books (or comics, manga) as titled in a Ukrainian reader's library, mostly translated editions.
For each, give the original title of the work (or its best-known English title for translations from other
languages) and the author's name in Latin script, so it can be found on Open Library.
Leave `title` empty for a book you don't recognise; never invent one. Keep every `id` as given.

{json.dumps(rows, ensure_ascii=False, indent=1)}"""
    try:
        result = await _run(llm, prompt, _Originals, label="library-originals", context={},
                            system="You are a librarian who knows world literature and its Ukrainian and Russian translations.")
    except HTTPException:
        return {}
    return {b.id: (b.title.strip(), b.author.strip()) for b in result.value.books if b.title.strip()}


@router.post("/match-many", response_model=list[LibraryDetails | None])
async def match_many(
    payload: list[LibraryMatchRequest],
    user: Annotated[UserResponse, Depends(get_current_user)],
    gkey: Annotated[str, Depends(get_google_books_key)],
    llm: Annotated[LLMClient | None, Depends(get_llm)],
):
    """Best match for up to 20 items at once (used by "Fill covers & details"), in the same order.
    Titles no catalogue knows (translated editions, mostly) get a second try under the original title from Gemini."""
    items = payload[:20]

    def one(t: LibraryMatchRequest) -> LibraryDetails | None:
        try:
            if t.source and t.source_id:
                return _details(gkey, t.source, t.source_id, t.kind)
            return _best_match(gkey, t.title, t.authors, t.kind)
        except HTTPException:
            return None

    def many(rows: list, fn) -> list:
        with ThreadPoolExecutor(max_workers=3) as pool:  # Open Library and Wikidata ask clients to stay gentle
            return list(pool.map(fn, rows))

    found = await run_in_threadpool(many, items, one)
    misses = [t for t, d in zip(items, found) if d is None and not t.source_id]
    if misses and llm is not None:
        originals = await _originals(llm, misses)

        def retry(t: LibraryMatchRequest) -> LibraryDetails | None:
            title, author = originals.get(t.id, ("", ""))
            if not title or _norm(title) == _norm(t.title):
                return None
            try:
                return _best_match(gkey, title, [author] if author else [], t.kind, _translated=True)
            except HTTPException:
                return None

        again = dict(zip((t.id for t in misses), await run_in_threadpool(many, misses, retry)))
        found = [d if d is not None else again.get(t.id) for t, d in zip(items, found)]
    return found


# --- Import (Notion CSV / spreadsheet) ----------------------------------------------------------

_IMPORT_COLUMNS = {
    "title": "title", "name": "title", "назва": "title", "книга": "title",
    "original title": "original_title", "оригінальна назва": "original_title",
    "genre": "genres", "genres": "genres", "jenre": "genres", "жанр": "genres", "жанри": "genres",
    "status": "status", "статус": "status",
    "score": "score", "rating": "score", "оцінка": "score",
    "author": "authors", "authors": "authors", "автор": "authors", "автори": "authors", "writer": "authors",
    "finish date": "finish_date", "finished": "finish_date", "date finished": "finish_date", "date read": "finish_date",
    "дата": "finish_date", "дата прочитання": "finish_date",
    "year": "year", "рік": "year",
    "pages": "pages", "сторінки": "pages", "сторінок": "pages",
    "volumes": "volumes_read", "volume": "volumes_read", "том": "volumes_read", "томи": "volumes_read",
    "recommended": "recommended", "recommend": "recommended", "рекомендую": "recommended", "рекомендація": "recommended",
    "notes": "notes", "нотатки": "notes", "comment": "notes",
    "type": "kind", "kind": "kind", "тип": "kind",
}

_STATUS_WORDS = {
    "read": ("прочитано", "прочитана", "прочитав", "прочитала", "read", "done", "finished", "completed"),
    "reading": ("читаю", "читаю зараз", "в процесі", "reading", "in progress"),
    "planned": ("планую", "хочу", "у планах", "в планах", "to read", "want to read", "planned", "not started"),
    "dropped": ("кинув", "кинула", "покинуто", "dropped", "abandoned", "did not finish", "dnf"),
}

_KIND_WORDS = {
    "manga": ("manga", "манга"),
    "comic": ("comic", "комікс", "graphic novel"),
    "magazine": ("magazine", "журнал"),
    "book": ("book", "книга"),
}

_MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"], 1)}
_MONTHS.update({m[:3]: i for m, i in list(_MONTHS.items())})
_UA_MONTHS = {
    "січ": 1, "лют": 2, "бер": 3, "квіт": 4, "трав": 5, "черв": 6, "лип": 7, "серп": 8, "вер": 9, "жовт": 10, "лист": 11, "груд": 12,
}


def _import_date(v: object) -> str:
    """Notion's "March 2, 2025", ISO, 02.03.2025, "2 березня 2025" or a spreadsheet date → ISO date."""
    if isinstance(v, (datetime, date)):
        return (v.date() if isinstance(v, datetime) else v).isoformat()
    raw = _cell(v).split("→")[0].strip().lower()  # Notion date ranges: "March 1, 2025 → March 9, 2025"
    if not raw:
        return ""
    if m := re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})", raw):
        y, mo, d = map(int, m.groups())
    elif m := re.match(r"(\d{1,2})[./](\d{1,2})[./](\d{4})", raw):
        d, mo, y = map(int, m.groups())
    elif m := re.match(r"([a-z]+)\.? (\d{1,2}),? (\d{4})", raw):
        mo, d, y = _MONTHS.get(m.group(1), 0), int(m.group(2)), int(m.group(3))
    elif m := re.match(r"(\d{1,2}) ([a-zа-яіїєґ]+)\.? (\d{4})", raw):
        word = m.group(2)
        mo = _MONTHS.get(word, 0) or next((n for k, n in _UA_MONTHS.items() if word.startswith(k)), 0)
        d, y = int(m.group(1)), int(m.group(3))
    else:
        return ""
    try:
        return date(y, mo, d).isoformat()
    except ValueError:
        return ""


def _import_score(v: object) -> float | None:
    raw = _cell(v)
    if not raw:
        return None
    stars = raw.count("⭐") + raw.count("★")
    if stars:
        return float(min(stars, 5))
    try:
        n = float(raw.replace(",", ".").split("/")[0])
    except ValueError:
        return None
    return max(0.0, min(5.0, n / 2 if n > 5 else n))  # a 10-point score becomes 5 stars


def _status(v: object) -> str:
    raw = _cell(v).lower()
    for status, words in _STATUS_WORDS.items():
        if any(raw == w or raw.startswith(w) for w in words):
            return status
    return "read" if not raw else "planned"


def _kind(v: object, default: str) -> str:
    raw = _cell(v).lower()
    for kind, words in _KIND_WORDS.items():
        if any(w in raw for w in words):
            return kind
    return default


def _int(v: object) -> int | None:
    m = re.search(r"\d+", _cell(v))
    return int(m.group(0)) if m else None


@router.post("/import", response_model=LibraryImportResponse)
async def import_books(
    user: Annotated[UserResponse, Depends(get_current_user)],
    file: UploadFile = File(...),
    kind: LibraryKind = "book",
):
    """Parse a Notion CSV export or a spreadsheet. Nothing is persisted: the client merges and saves via PUT."""
    filename = (file.filename or "").lower()
    if not filename.endswith((".xlsx", ".xlsm", ".csv")):
        raise HTTPException(status_code=400, detail="Upload a .csv (Notion export) or .xlsx file.")
    table = _read_import_table(filename, await file.read())

    def header_key(cell: object) -> str | None:
        return _IMPORT_COLUMNS.get(re.sub(r"\s+", " ", _cell(cell).lower().lstrip("﻿")))

    header_idx = next((i for i, r in enumerate(table[:20]) if any(header_key(c) == "title" for c in r)), None)
    if header_idx is None:
        raise HTTPException(status_code=400, detail="No header row with a 'Title' (or 'Назва') column found.")
    header = table[header_idx]
    body = [r for r in table[header_idx + 1 :] if any(_cell(c) for c in r)]
    columns: dict[str, int] = {}
    for i, cell in enumerate(header):
        key = header_key(cell)
        if key and key not in columns:
            columns[key] = i
    if "recommended" not in columns:
        # Notion's checkbox column may have no name: the first unnamed column holding only yes/no values.
        for i, _ in enumerate(header):
            if i in columns.values():
                continue
            values = {_cell(r[i]).lower() for r in body if i < len(r)}
            if values and values <= (_TRUE | _FALSE) and values & _TRUE:
                columns["recommended"] = i
                break

    def get(r: list[object], key: str) -> object:
        i = columns.get(key)
        return r[i] if i is not None and i < len(r) else None

    today = date.today().isoformat()
    rows: list[LibraryItem] = []
    skipped = 0
    for r in body:
        title = _cell(get(r, "title"))
        if not title:
            skipped += 1
            continue
        rows.append(
            LibraryItem(
                id=uuid.uuid4().hex,
                kind=_kind(get(r, "kind"), kind) if "kind" in columns else kind,
                title=title,
                original_title=_cell(get(r, "original_title")),
                recommended=_cell(get(r, "recommended")).lower() in _TRUE,
                genres=_list(get(r, "genres")),
                status=_status(get(r, "status")),
                score=_import_score(get(r, "score")),
                authors=_list(get(r, "authors")),
                finish_date=_import_date(get(r, "finish_date")),
                year=_year(get(r, "year")),
                pages=_int(get(r, "pages")),
                volumes_read=_int(get(r, "volumes_read")),
                notes=_cell(get(r, "notes")),
                added_at=today,
            )
        )
    return LibraryImportResponse(rows=rows, skipped=skipped)
