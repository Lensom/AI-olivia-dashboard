"""Wikidata for the Library: a book's entity, the series it belongs to, and that series' books.

Uses the regular API (wbsearchentities, wbgetentities and the `haswbstatement:` search), not the SPARQL
endpoint, which throttles hard. The API still answers bursts with 429, so calls go one at a time with a
short pause and honour Retry-After, and answers are cached for a week."""

from __future__ import annotations

import json
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import HTTPException

_API = "https://www.wikidata.org/w/api.php?"
# Wikimedia allows 10 requests a minute to clients it can't identify, and 200 to ones whose User-Agent has
# contact details (a URL or an email). Set from WIKIDATA_CONTACT in main.py.
CONTACT = ""
_TTL = 7 * 24 * 60 * 60
_GAP = 0.5  # seconds between calls

_cache: dict[str, tuple[float, dict]] = {}
_lock = threading.Lock()
_last_call = 0.0

BOOK_WORDS = ("роман", "книга", "повість", "збірка", "манга", "комікс", "novel", "book", "manga", "comic", "series of", "short stories")
NOT_BOOK_WORDS = ("фільм", "film", "серіал", "телефільм", "відеогра", "video game", "сторінка значень", "disambiguation")


def api(params: dict[str, object]) -> dict:
    """One Wikidata API call, cached, throttled and retried on 429 / 5xx."""
    global _last_call
    url = _API + urlencode({**params, "format": "json"})
    hit = _cache.get(url)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]
    with _lock:
        for attempt in range(4):
            wait = _GAP - (time.time() - _last_call)
            if wait > 0:
                time.sleep(wait)
            _last_call = time.time()
            agent = f"OliviaDashboard/1.0 ({CONTACT}) python-urllib" if CONTACT else "OliviaDashboard/1.0 python-urllib"
            try:
                with urlopen(Request(url, headers={"User-Agent": agent, "Accept": "application/json"}), timeout=20) as res:
                    data = json.loads(res.read().decode("utf-8"))
                break
            except HTTPError as exc:
                if (exc.code < 500 and exc.code != 429) or attempt == 3:
                    raise HTTPException(status_code=502, detail=f"Wikidata error {exc.code}.") from exc
                retry = exc.headers.get("Retry-After") if exc.headers else None
                # Without Retry-After, Wikimedia asks for at least five seconds.
                time.sleep(min(float(retry) if retry and retry.isdigit() else 5.0 * (attempt + 1), 20))
            except (URLError, TimeoutError) as exc:
                if attempt == 3:
                    raise HTTPException(status_code=502, detail="Could not reach Wikidata.") from exc
                time.sleep(1.5 * (attempt + 1))
    _cache[url] = (time.time(), data)
    return data


def _value(claim: dict) -> object:
    return (claim.get("mainsnak") or {}).get("datavalue", {}).get("value")


def claim_ids(entity: dict, prop: str) -> list[str]:
    return [v["id"] for c in (entity.get("claims") or {}).get(prop, []) if isinstance(v := _value(c), dict) and "id" in v]


def claim_strings(entity: dict, prop: str) -> list[str]:
    return [v for c in (entity.get("claims") or {}).get(prop, []) if isinstance(v := _value(c), str)]


def label(entity: dict, *langs: str) -> str:
    labels = entity.get("labels") or {}
    return next((labels[l]["value"] for l in langs if l in labels), "")


def entities(ids: list[str], props: str = "labels|claims", languages: str = "uk|en") -> dict[str, dict]:
    out: dict[str, dict] = {}
    ids = list(dict.fromkeys(ids))
    for i in range(0, len(ids), 50):
        data = api({"action": "wbgetentities", "ids": "|".join(ids[i : i + 50]), "props": props, "languages": languages})
        out.update({k: v for k, v in (data.get("entities") or {}).items() if "missing" not in v})
    return out


def search_statement(statement: str, limit: int = 100) -> tuple[list[str], int]:
    """Items matching `haswbstatement:` (e.g. "P179=Q8337", or several joined with "|"), and the total.

    Every caller asks about something that exists, yet the search servers now and then answer with no hits:
    an empty answer is asked again (a different srlimit makes a new URL, so the cache doesn't replay it)."""
    for attempt in range(3):
        data = api({"action": "query", "list": "search", "srsearch": f"haswbstatement:{statement}", "srlimit": limit + attempt, "srnamespace": 0})
        q = data.get("query") or {}
        hits = [h["title"] for h in q.get("search") or []][:limit]
        if hits:
            return hits, int((q.get("searchinfo") or {}).get("totalhits") or len(hits))
    return [], 0


def find_book(title: str, language: str = "uk") -> str | None:
    """The entity of a book known by this title (in `language`), skipping films and disambiguation pages."""
    hits = api({"action": "wbsearchentities", "search": title, "language": language, "uselang": language,
                "type": "item", "limit": 7}).get("search") or []

    def is_book(h: dict) -> bool:
        d = (h.get("description") or "").lower()
        return any(w in d for w in BOOK_WORDS) and not any(w in d for w in NOT_BOOK_WORDS)

    return next((h["id"] for h in hits if is_book(h)), None)


def by_open_library(work_ids: list[str]) -> dict[str, str]:
    """Open Library work id (OL…W) → Wikidata entity, for the works Wikidata links (P648)."""
    out: dict[str, str] = {}
    work_ids = [w for w in dict.fromkeys(work_ids) if re.fullmatch(r"OL\d+W", w)]
    for i in range(0, len(work_ids), 20):
        chunk = work_ids[i : i + 20]
        found, _ = search_statement("|".join(f"P648={w}" for w in chunk), limit=50)
        for qid, e in entities(found, props="claims").items():
            for w in claim_strings(e, "P648"):
                if w in chunk:
                    out.setdefault(w, qid)
    return out


def english_title(qid: str) -> tuple[str, str] | None:
    """English title and first author of a book entity."""
    e = entities([qid], languages="en").get(qid)
    if not e:
        return None
    title = label(e, "en")
    authors = claim_ids(e, "P50")
    author = label(entities(authors[:1], props="labels", languages="en").get(authors[0], {}), "en") if authors else ""
    return (title, author) if title else None
