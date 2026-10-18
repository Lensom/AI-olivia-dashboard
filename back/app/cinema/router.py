from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from threading import Lock
import gzip
from typing import Annotated, Literal
import json
import re
import time
import uuid
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from psycopg import Connection
from psycopg.types.json import Json

from app.auth.router import get_current_user, get_conn
from app.auth.schemas import UserResponse
from app.cinema.schemas import (
    CinemaData,
    CinemaDetails,
    CinemaImdbRating,
    CinemaImportResponse,
    CinemaKind,
    CinemaResponse,
    CinemaSearchResult,
    CinemaTitle,
)
from app.investing.router import _read_import_table


router = APIRouter(prefix="/cinema", tags=["cinema"])


def get_tmdb_key() -> str:
    """Overridden in main.py with TMDB_API_KEY from settings."""
    return ""


_TMDB = "https://api.themoviedb.org/3"
_IMG = "https://image.tmdb.org/t/p"
_ANIMATION_GENRE = 16
_TMDB_TTL = 60 * 60
_tmdb_cache: dict[str, tuple[float, dict]] = {}

# Which TMDB catalogue each page searches.
_KIND_MEDIA: dict[str, Literal["movie", "tv"]] = {
    "film": "movie",
    "cartoon": "movie",
    "tv": "tv",
    "animated_series": "tv",
    "anime": "tv",
    "show": "tv",
}


def _tmdb_get(key: str, path: str, params: dict[str, object]) -> dict:
    if not key:
        raise HTTPException(
            status_code=503,
            detail="TMDB is not configured. Add TMDB_API_KEY to back/.env (free key: themoviedb.org/settings/api).",
        )
    query = {k: v for k, v in params.items() if v not in (None, "")}
    headers = {"Accept": "application/json"}
    # v4 read access tokens are JWTs and go in the header; v3 keys go in the query string.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    else:
        query["api_key"] = key
    url = f"{_TMDB}{path}?{urlencode(query)}"
    cache_key = url.replace(key, "")
    hit = _tmdb_cache.get(cache_key)
    if hit and time.time() - hit[0] < _TMDB_TTL:
        return hit[1]
    try:
        with urlopen(Request(url, headers=headers), timeout=10) as res:
            data = json.loads(res.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 401:
            raise HTTPException(status_code=502, detail="TMDB rejected the API key. Check TMDB_API_KEY.") from exc
        if exc.code == 404:
            raise HTTPException(status_code=404, detail="Title not found on TMDB.") from exc
        raise HTTPException(status_code=502, detail=f"TMDB error {exc.code}.") from exc
    except (URLError, TimeoutError) as exc:
        raise HTTPException(status_code=502, detail="Could not reach TMDB.") from exc
    _tmdb_cache[cache_key] = (time.time(), data)
    return data


# Global IMDb ratings come from IMDb's free daily dataset (non-commercial use), cached on disk for a day.
_IMDB_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz"
_IMDB_FILE = Path(__file__).resolve().parents[2] / ".cache" / "imdb_title_ratings.tsv.gz"
_IMDB_TTL = 24 * 60 * 60
_imdb_lock = Lock()
_imdb_ratings: dict[str, tuple[float, int]] = {}  # only the ids asked for so far
_imdb_loaded_at = 0.0  # mtime of the file _imdb_ratings was read from


def _imdb_file() -> Path | None:
    """The ratings file, downloaded again when older than a day. A stale file beats none if IMDb is unreachable."""
    fresh = _IMDB_FILE.exists() and time.time() - _IMDB_FILE.stat().st_mtime < _IMDB_TTL
    if not fresh:
        try:
            _IMDB_FILE.parent.mkdir(parents=True, exist_ok=True)
            tmp = _IMDB_FILE.with_suffix(".part")
            with urlopen(Request(_IMDB_RATINGS_URL, headers={"User-Agent": "olivia"}), timeout=60) as res:
                tmp.write_bytes(res.read())
            tmp.replace(_IMDB_FILE)
        except (URLError, TimeoutError, OSError):
            pass
    return _IMDB_FILE if _IMDB_FILE.exists() else None


def _imdb_lookup(ids: list[str]) -> dict[str, tuple[float, int]]:
    """(rating, votes) for each IMDb id that has a rating. Scans the 1.5M-row file only for ids not seen yet."""
    global _imdb_loaded_at
    wanted = {i for i in ids if re.fullmatch(r"tt\d+", i or "")}
    if not wanted:
        return {}
    with _imdb_lock:
        path = _imdb_file()
        if path is None:
            return {}
        mtime = path.stat().st_mtime
        if mtime != _imdb_loaded_at:
            _imdb_ratings.clear()  # a new day's file: re-read everything asked for
            _imdb_loaded_at = mtime
        missing = wanted - _imdb_ratings.keys()
        if missing:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                next(f, None)
                for line in f:
                    tconst, _, rest = line.partition("\t")
                    if tconst in missing:
                        rating, _, votes = rest.partition("\t")
                        _imdb_ratings[tconst] = (float(rating), int(votes))
                        missing.discard(tconst)
                        if not missing:
                            break
            for i in missing:  # unrated on IMDb: remember that too
                _imdb_ratings[i] = (0.0, 0)
        return {i: _imdb_ratings[i] for i in wanted if _imdb_ratings[i][1] > 0}


def _img(path: str | None, size: str) -> str:
    return f"{_IMG}/{size}{path}" if path else ""


def _year(value: str | None) -> int | None:
    m = re.match(r"(\d{4})", value or "")
    return int(m.group(1)) if m else None


def _search(key: str, language: str, q: str, kind: str, year: int | None) -> list[CinemaSearchResult]:
    media = _KIND_MEDIA.get(kind, "movie")
    params: dict[str, object] = {"query": q, "language": language, "include_adult": "false"}
    if year:
        params["year" if media == "movie" else "first_air_date_year"] = year
    data = _tmdb_get(key, f"/search/{media}", params)
    out = [
        CinemaSearchResult(
            tmdb_id=int(r["id"]),
            tmdb_media=media,
            title=r.get("title") or r.get("name") or "",
            original_title=r.get("original_title") or r.get("original_name") or "",
            original_language=r.get("original_language") or "",
            year=_year(r.get("release_date") or r.get("first_air_date")),
            poster=_img(r.get("poster_path"), "w185"),
            overview=r.get("overview") or "",
            tmdb_rating=round(float(r["vote_average"]), 1) if r.get("vote_average") else None,
            animation=_ANIMATION_GENRE in (r.get("genre_ids") or []),
            votes=int(r.get("vote_count") or 0),
        )
        for r in (data.get("results") or [])[:12]
    ]
    # Cartoons and animated series float animation to the top; films and TV shows the rest.
    # Cartoons, animated series and anime float animation to the top (anime: Japanese first); the rest the opposite.
    return sorted(out, key=lambda r: _kind_fit(r, kind))  # stable: keeps TMDB relevance within groups


def _details(key: str, language: str, media: Literal["movie", "tv"], tmdb_id: int) -> CinemaDetails:
    credits = "credits" if media == "movie" else "aggregate_credits"
    d = _tmdb_get(key, f"/{media}/{tmdb_id}", {"language": language, "append_to_response": f"{credits},external_ids"})
    overview = d.get("overview") or ""
    if not overview and not language.startswith("en"):
        overview = _tmdb_get(key, f"/{media}/{tmdb_id}", {"language": "en-US"}).get("overview") or ""

    cast = sorted((d.get(credits) or {}).get("cast") or [], key=lambda c: c.get("order", 999))
    companies = [c["name"] for c in d.get("production_companies") or [] if c.get("name")]
    if media == "movie":
        studios = companies[:3]
        directors = [c["name"] for c in (d.get("credits") or {}).get("crew") or [] if c.get("job") == "Director"]
        runtime = d.get("runtime") or None
        seasons = None
    else:
        networks = [n["name"] for n in d.get("networks") or [] if n.get("name")]
        studios = list(dict.fromkeys(networks[:2] + companies[:2]))
        directors = [c["name"] for c in d.get("created_by") or [] if c.get("name")]
        runtime = (d.get("episode_run_time") or [None])[0]
        seasons = d.get("number_of_seasons") or None

    return CinemaDetails(
        tmdb_id=tmdb_id,
        tmdb_media=media,
        title=d.get("title") or d.get("name") or "",
        original_title=d.get("original_title") or d.get("original_name") or "",
        year=_year(d.get("release_date") or d.get("first_air_date")),
        genres=[g["name"] for g in d.get("genres") or [] if g.get("name")],
        studios=studios,
        actors=[c["name"] for c in cast[:10] if c.get("name")],
        directors=list(dict.fromkeys(directors))[:3],
        poster=_img(d.get("poster_path"), "w342"),
        backdrop=_img(d.get("backdrop_path"), "w780"),
        overview=overview,
        runtime=runtime,
        seasons=seasons,
        tmdb_rating=round(float(d["vote_average"]), 1) if d.get("vote_average") else None,
        **_imdb_fields(d.get("imdb_id") or (d.get("external_ids") or {}).get("imdb_id") or ""),
    )


def _imdb_fields(imdb_id: str) -> dict[str, object]:
    hit = _imdb_lookup([imdb_id]).get(imdb_id) if imdb_id else None
    return {"imdb_id": imdb_id, "imdb_rating": hit[0] if hit else None, "imdb_votes": hit[1] if hit else None}


def _language(conn: Connection, user_id: int) -> str:
    row = conn.execute("SELECT data->>'language' FROM cinema_titles WHERE user_id = %s", (user_id,)).fetchone()
    return (row[0] if row and row[0] else None) or CinemaData().language


@router.get("", response_model=CinemaResponse)
def get_cinema(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
):
    row = conn.execute("SELECT data, updated_at FROM cinema_titles WHERE user_id = %s", (user.id,)).fetchone()
    data = CinemaData(**(row[0] if row and isinstance(row[0], dict) else {}))
    return CinemaResponse(**data.model_dump(), updated_at=str(row[1]) if row else None, tmdb_enabled=bool(tmdb_key))


@router.put("", response_model=CinemaResponse)
def update_cinema(
    payload: CinemaData,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
):
    data = payload.model_dump()
    if "lists" not in payload.model_fields_set:
        # A client that doesn't know about lists (e.g. a tab opened before they existed) must not wipe them.
        saved = conn.execute("SELECT data->'lists' FROM cinema_titles WHERE user_id = %s", (user.id,)).fetchone()
        data["lists"] = saved[0] if saved and isinstance(saved[0], list) else []
    row = conn.execute(
        """
        INSERT INTO cinema_titles(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(data)),
    ).fetchone()
    conn.commit()
    return CinemaResponse(**data, updated_at=str(row[0]) if row else None, tmdb_enabled=bool(tmdb_key))


@router.get("/search", response_model=list[CinemaSearchResult])
def search_titles(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
    q: str = Query(min_length=1, max_length=200),
    kind: CinemaKind = "film",
    year: int | None = None,
):
    return _search(tmdb_key, _language(conn, user.id), q.strip(), kind, year)


@router.get("/details", response_model=CinemaDetails)
def title_details(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
    media: Literal["movie", "tv"],
    tmdb_id: int,
):
    return _details(tmdb_key, _language(conn, user.id), media, tmdb_id)


def _kind_fit(r: CinemaSearchResult, kind: str) -> int:
    """0 = fits the page best; higher = worse (a live-action result on Anime, a cartoon on Films…)."""
    want_animation = kind in ("cartoon", "animated_series", "anime")
    miss = int(r.animation != want_animation)
    if kind == "anime":
        miss = miss * 2 + int(r.original_language != "ja")
    return miss


def _norm_title(s: str) -> str:
    return re.sub(r"[\W_]+", "", s.lower())


_CONNECTORS = {"і", "й", "та", "и", "в", "у", "з", "із", "зі", "the", "a", "and", "of"}


def _query_variants(title: str) -> list[str]:
    """The title as typed, then looser forms: TMDB's localized name may differ in a connector word
    ("Гаррі Поттер і…" vs "…та…"), extra notes in brackets or quotes, or the part before a colon."""
    base = title.strip()
    plain = re.sub(r"\([^)]*\)|[\"«»“”„]", " ", base)
    words = [w for w in re.split(r"\s+", plain) if w and w.lower().strip(".,:;!?") not in _CONNECTORS]
    loose = re.sub(r"\s+", " ", " ".join(words)).strip(" :.-")
    head = plain.split(":")[0].strip()
    out: list[str] = []
    for q in (base, re.sub(r"\s+", " ", plain).strip(), loose, head):
        if q and len(q) >= 2 and q not in out:
            out.append(q)
    return out


def _best_match(key: str, language: str, title: str, kind: str, year: int | None) -> CinemaDetails | None:
    results: list[CinemaSearchResult] = []
    for query in _query_variants(title):
        results = _search(key, language, query, kind, year)
        if not results and year:
            # Release years in personal lists are often off by one (festival vs. wide release).
            results = [r for r in _search(key, language, query, kind, None) if r.year and abs(r.year - year) <= 1]
        if results:
            break
    if not results:
        return None
    # TMDB relevance alone picks namesakes (e.g. a making-of documentary over the film itself):
    # prefer the right kind of title, an exact name, the exact year, then the most-rated one.
    want = _norm_title(title)
    best = max(
        results,
        key=lambda r: (
            -_kind_fit(r, kind),
            want in (_norm_title(r.title), _norm_title(r.original_title)),
            year is not None and r.year == year,
            r.votes,
        ),
    )
    return _details(key, language, best.tmdb_media, best.tmdb_id)


@router.get("/match", response_model=CinemaDetails | None)
def match_title(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
    title: str = Query(min_length=1, max_length=200),
    kind: CinemaKind = "film",
    year: int | None = None,
):
    """Best TMDB match for a title typed by hand or imported (null when nothing fits)."""
    return _best_match(tmdb_key, _language(conn, user.id), title, kind, year)


# Header aliases, lower-cased: English and Ukrainian, as exported from Notion or typed by hand.
_IMPORT_COLUMNS = {
    "title": "title", "name": "title", "назва": "title", "фільм": "title",
    "original title": "original_title", "оригінальна назва": "original_title",
    "genre": "genres", "genres": "genres", "жанр": "genres", "жанри": "genres",
    "status": "status", "статус": "status",
    "score": "score", "rating": "score", "grade": "score", "оцінка": "score",
    "year": "year", "рік": "year", "release year": "year",
    "view year": "view_year", "viewed": "view_year", "watched year": "view_year", "рік перегляду": "view_year",
    "studio / distributor": "studios", "studio/distributor": "studios", "studio": "studios",
    "studios": "studios", "distributor": "studios", "студія": "studios",
    "actors": "actors", "cast": "actors", "актори": "actors",
    "recommended": "recommended", "recommend": "recommended", "рекомендую": "recommended",
    "рекомендація": "recommended", "my recommendation": "recommended",
    "notes": "notes", "нотатки": "notes", "comment": "notes",
    "type": "kind", "kind": "kind", "тип": "kind",
    "season": "watched_seasons", "seasons": "watched_seasons", "seasons watched": "watched_seasons",
    "сезон": "watched_seasons", "сезони": "watched_seasons",
}

_STATUS_WORDS = {
    "watched": ("переглянуто", "переглянутий", "переглянула", "переглянув", "watched", "done", "completed", "seen", "просмотрено"),
    "watching": ("дивлюсь", "дивлюся", "дивлюсь зараз", "в процесі", "watching", "in progress", "смотрю"),
    "planned": ("планую", "хочу", "у планах", "в планах", "заплановано", "plan", "planned", "to watch", "not started", "want"),
    "dropped": ("кинув", "кинула", "покинуто", "закинув", "dropped", "abandoned", "бросил"),
}

_KIND_WORDS = {
    "film": ("film", "movie", "фільм"),
    "tv": ("tv", "series", "серіал"),
    "show": ("tv show", "tv-show", "show", "шоу", "реаліті", "телешоу"),
    "anime": ("anime", "аніме"),
    "cartoon": ("cartoon", "animation", "мультфільм", "мульт"),
    "animated_series": ("animated series", "мультсеріал"),
}

_TRUE = {"yes", "true", "1", "✓", "✔", "x", "так", "да", "checked"}
_FALSE = {"no", "false", "0", "", "ні", "нет", "unchecked"}


def _cell(v: object) -> str:
    return "" if v is None else str(v).strip()


def _list(v: object) -> list[str]:
    # Notion exports multi-selects as "A, B, C".
    return [p.strip() for p in re.split(r"[,;\n]", _cell(v)) if p.strip()]


def _int_year(v: object) -> int | None:
    m = re.search(r"(19|20)\d{2}", _cell(v))
    return int(m.group(0)) if m else None


def _watched_seasons(v: object) -> int | None:
    # Notion multi-select "1, -, 6" (seasons 1 to 6) or a plain "3": the highest season watched.
    nums = [int(n) for n in re.findall(r"\d+", _cell(v)) if 0 < int(n) < 100]
    return max(nums) if nums else None


def _status(v: object, has_score: bool) -> str:
    raw = _cell(v).lower()
    for status, words in _STATUS_WORDS.items():
        if any(raw == w or raw.startswith(w) for w in words):
            return status
    return "watched" if has_score or not raw else "planned"


def _kind(v: object, default: str) -> str:
    raw = _cell(v).lower()
    for kind in ("anime", "animated_series", "cartoon", "show", "tv", "film"):  # most specific first
        if any(raw == w or w in raw for w in _KIND_WORDS[kind]):
            return kind
    return default


@router.post("/import", response_model=CinemaImportResponse)
async def import_titles(
    user: Annotated[UserResponse, Depends(get_current_user)],
    file: UploadFile = File(...),
    kind: CinemaKind = "film",
):
    """Parse a Notion CSV export or a spreadsheet. Nothing is persisted: the client merges and saves via PUT."""
    filename = (file.filename or "").lower()
    if not filename.endswith((".xlsx", ".xlsm", ".csv")):
        raise HTTPException(status_code=400, detail="Upload a .csv (Notion export) or .xlsx file.")
    table = _read_import_table(filename, await file.read())

    def header_key(cell: object) -> str | None:
        label = re.sub(r"\s+", " ", _cell(cell).lower().lstrip("﻿"))
        return _IMPORT_COLUMNS.get(label)

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
        # Notion's checkbox column may have no name: take the first unnamed column holding only yes/no values.
        for i, cell in enumerate(header):
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
    rows: list[CinemaTitle] = []
    skipped = 0
    for r in body:
        title = _cell(get(r, "title"))
        if not title:
            skipped += 1
            continue
        score_raw = _cell(get(r, "score")).replace(",", ".")
        try:
            score = max(0.0, min(10.0, float(score_raw))) if score_raw else None
        except ValueError:
            score = None
        rows.append(
            CinemaTitle(
                id=uuid.uuid4().hex,
                kind=_kind(get(r, "kind"), kind) if "kind" in columns else kind,
                title=title,
                original_title=_cell(get(r, "original_title")),
                recommended=_cell(get(r, "recommended")).lower() in _TRUE,
                genres=_list(get(r, "genres")),
                status=_status(get(r, "status"), score is not None),
                score=score,
                year=_int_year(get(r, "year")),
                view_year=_int_year(get(r, "view_year")),
                studios=_list(get(r, "studios")),
                actors=_list(get(r, "actors")),
                notes=_cell(get(r, "notes")),
                watched_seasons=_watched_seasons(get(r, "watched_seasons")),
                added_at=today,
            )
        )
    return CinemaImportResponse(rows=rows, skipped=skipped)


@router.post("/match-many", response_model=list[CinemaDetails | None])
def match_many(
    payload: list[CinemaTitle],
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
):
    """Best match for up to 20 titles at once (used by "Fill from TMDB"), in the same order."""
    if not tmdb_key:
        _tmdb_get(tmdb_key, "", {})  # raises the "not configured" error
    language = _language(conn, user.id)

    def one(t: CinemaTitle) -> CinemaDetails | None:
        try:
            if t.tmdb_id and t.tmdb_media:
                return _details(tmdb_key, language, t.tmdb_media, t.tmdb_id)
            return _best_match(tmdb_key, language, t.title, t.kind, t.year)
        except HTTPException:
            return None

    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(one, payload[:20]))


@router.post("/imdb-ratings", response_model=dict[str, CinemaImdbRating])
def imdb_ratings(
    payload: list[CinemaTitle],
    user: Annotated[UserResponse, Depends(get_current_user)],
    tmdb_key: Annotated[str, Depends(get_tmdb_key)],
):
    """Current global IMDb rating per title id. Titles without an IMDb id get it from TMDB (when matched there)."""
    ids: dict[str, str] = {t.id: t.imdb_id for t in payload if t.imdb_id}
    need_id = [t for t in payload if not t.imdb_id and t.tmdb_id and t.tmdb_media]

    def external(t: CinemaTitle) -> tuple[str, str]:
        try:
            return t.id, _tmdb_get(tmdb_key, f"/{t.tmdb_media}/{t.tmdb_id}/external_ids", {}).get("imdb_id") or ""
        except HTTPException:
            return t.id, ""

    if need_id and tmdb_key:
        with ThreadPoolExecutor(max_workers=6) as pool:
            ids.update({k: v for k, v in pool.map(external, need_id[:200]) if v})
    ratings = _imdb_lookup(list(ids.values()))
    return {
        tid: CinemaImdbRating(
            imdb_id=iid,
            imdb_rating=ratings[iid][0] if iid in ratings else None,
            imdb_votes=ratings[iid][1] if iid in ratings else None,
        )
        for tid, iid in ids.items()
    }
