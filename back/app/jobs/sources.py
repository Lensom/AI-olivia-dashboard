"""Where vacancies come from: public job feeds and pages, read only when you press refresh.

Only sites that allow it (robots.txt) and answer without tricks: company career APIs, Norway's NAV,
visajobs.xyz, the relocate.me sitemap and EURES for the Netherlands. Indeed blocks servers and Jobindex's robots.txt forbids it, so neither is here.
Every URL fetched is built from a host written in this file; links found in pages are only ever shown, never fetched."""

from __future__ import annotations

import json
import re
import ssl
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from hashlib import sha1
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

import certifi

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
_TIMEOUT = 15
_DEADLINE = 20  # seconds for a whole answer
_MAX_AGE_DAYS = 180  # visajobs still lists 2024 postings: long closed, in all likelihood
DESCRIPTION_LIMIT = 8000
_TLS = ssl.create_default_context(cafile=certifi.where())  # Windows' own store can't verify europa.eu

# Companies with open roles in these countries, on career platforms with a public API.
GREENHOUSE = (
    "adyen", "catawiki", "cognite", "databricks", "datadog", "dept", "elastic", "flowtraders", "fourthline", "getyourguide",
    "gitlab", "grafanalabs", "hellofresh", "imc", "nebius", "sumup", "travix", "trustpilot", "wolt",
)
ASHBY = ("bynder", "corti", "crisp", "doctolib", "lightspeedhq", "miro", "mollie", "pandektes", "pleo", "polarsteps", "sanity", "toogoodtogo")
LEVER = ("dnb", "mendix", "veo")
LEVER_EU = ("siteimprove", "tomtom")
RECRUITEE = (
    "bunq", "channable", "cmcom", "effectory", "fastned", "greenchoice", "nmbrs", "payconiq", "shiftbase", "sqills", "ticketswap", "vandebron",
)
SMARTRECRUITERS = ("coolblue", "kpn", "picnic")
WORKABLE = ("kahoot",)
# Where a slug doesn't read as the company's name. Also what the sponsor registers get compared with.
_COMPANY_NAMES = {
    "cmcom": "CM.com", "dept": "DEPT", "flowtraders": "Flow Traders", "grafanalabs": "Grafana Labs", "imc": "IMC",
    "kpn": "KPN", "lightspeedhq": "Lightspeed", "ticketswap": "TicketSwap", "toogoodtogo": "Too Good To Go",
}

_EURES_PAGES = 2
_EURES_PAGE_SIZE = 50
_EURES_PAUSE_SECONDS = 10  # europa.eu's robots.txt asks for this between requests
_DEAD_TECH = re.compile(r"\bflash\b", re.I)  # nobody hires for Flash now: an old ad published again

_COUNTRIES = {
    "NL": re.compile(r"\b(netherlands|amsterdam|rotterdam|utrecht|eindhoven|the hague|den haag|groningen|delft|leiden)\b", re.I),
    "NO": re.compile(r"\b(norway|oslo|trondheim|stavanger)\b", re.I),
    "DK": re.compile(r"\b(denmark|copenhagen|københavn|aarhus|odense|billund)\b", re.I),
}
_FRONTEND = re.compile(r"front[\s-]?end|\b(react|vue|angular|next\.?js|javascript|typescript)\b|\b(web|ui)\s+(developer|engineer)\b", re.I)
_BACKEND = re.compile(r"back[\s-]?end", re.I)
_FULLSTACK = re.compile(r"full[\s-]?stack", re.I)
# "Software Engineer" in Europe is often a React job: for generic titles the ad's text decides, not the title.
_GENERIC = re.compile(r"\b(engineer|developer|programmer|ontwikkelaar|utvikler|udvikler|systemutvikler|softwareudvikler)\b", re.I)
# Generic titles that still name another specialty are left out without reading the ad.
_OTHER_SPECIALTY = re.compile(
    r"back[\s-]?end|(?<!\w)(\.net|c#|c\+\+)(?!\w)|\b(data|machine learning|ml|ai|devops|sre|site reliability|platform|infrastructure|"
    r"cloud|network|security|embedded|firmware|hardware|mobile|ios|android|qa|test|testing|automation|sales|support|solutions?|"
    r"analytics|database|game|graphics|java|python|golang|ruby|php|scala|kotlin|rust|electrical|mechanical|civil|process|"
    r"quality|reliability|manager|director|architect|trading|compliance|gtm|haskell|elixir|clojure|erlang|node(?:\.?js)?|"
    r"wordpress|drupal|aem|sap|salesforce|actionscript|magento|e-?commerce)\b",
    re.I,
)
_FE_SIGNAL = re.compile(
    r"front[\s-]?end|\b(react(?:\.?js)?|vue(?:\.?js)?|angular|svelte|next\.?js|nuxt|typescript|javascript|css|html|tailwind|redux|storybook)\b",
    re.I,
)
_BE_SIGNAL = re.compile(
    r"(?<!\w)(\.net|c#|c\+\+)(?!\w)|\b(java|kotlin|scala|spring|golang|python|django|flask|ruby|rails|php|laravel|rust|elixir|"
    r"kubernetes|terraform|kafka|spark)\b",
    re.I,
)
_FE_CORE = {"react", "vue", "angular", "svelte", "next.js", "nextjs", "nuxt", "typescript"}
_DETAIL_BUDGET = 40  # ads fetched per refresh to read generic titles whose list has no text (Greenhouse, SmartRecruiters)
_NOT_THE_ROLE = re.compile(r"\b(intern|internship|working student|praktikant|recruiter|product manager|engineering manager|designer)\b", re.I)
_RELOCATE_JOB = re.compile(r"https://relocate\.me/(netherlands|norway|denmark)/([a-z0-9-]+)/([a-z0-9-]+)/([a-z0-9-]+-(\d+))")
_RELOCATE_COUNTRY = {"netherlands": "NL", "norway": "NO", "denmark": "DK"}
_NAV_ID = re.compile(r"^[0-9a-f-]{36}$")

_LOCAL_WORDS = frozenset(
    """de het een en van voor met wij je bij naar zijn ook niet worden werken ervaring functie
    og det er for vi som til på av med du deg har vil skal ikke jobbe erfaring stillingen
    at vores hos dig kan arbejde erfaring stillingen""".split()
)
_ENGLISH_WORDS = frozenset("the and of to with you your we our for will are is in on as that this have experience team work".split())


@dataclass
class RawJob:
    source: str
    external_id: str
    title: str
    company: str
    location: str
    country: str
    url: str
    posted: str = ""  # YYYY-MM-DD
    relocation_stated: bool = False  # the source itself says so
    visa_stated: bool = False
    english_stated: bool = False
    by_description: bool = False  # a generic title kept because its ad is front-end work
    role: str = ""  # set when the ad decided it; otherwise it comes from the title
    description: str = ""
    detail: dict[str, str] = field(default_factory=dict)  # how to fetch the full text later

    @property
    def id(self) -> str:
        return sha1(f"{self.source}:{self.external_id}".encode(), usedforsecurity=False).hexdigest()[:20]  # an id, not security

    def to_data(self) -> dict[str, Any]:
        data = asdict(self)
        # With no employer named, "same title" isn't the same job: only the same ad text is.
        who = self.company or sha1((self.description or self.external_id).encode(), usedforsecurity=False).hexdigest()
        data["dedupe_key"] = dedupe_key(who, self.title, self.country)
        data["role"] = self.role or job_role(self.title)
        return data


@dataclass
class SourceResult:
    source: str
    ok: bool
    found: int = 0
    error: str = ""


class SourceError(Exception):
    pass


def _get(url: str, body: dict[str, Any] | None = None) -> str:
    """GET, or POST when there's a JSON body."""
    headers = {"User-Agent": _UA, "Accept": "*/*"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    # The socket timeout is per read: a server trickling its answer could take minutes (Lever once took 254 s), so the
    # whole answer also has a deadline.
    deadline = time.monotonic() + _DEADLINE
    try:
        with urlopen(Request(url, data=data, headers=headers), timeout=_TIMEOUT, context=_TLS) as response:
            chunks = []
            while chunk := response.read(65536):
                chunks.append(chunk)
                if time.monotonic() > deadline:
                    raise SourceError("too slow")
            return b"".join(chunks).decode("utf-8", "ignore")
    except HTTPError as exc:
        raise SourceError(f"HTTP {exc.code}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise SourceError("can't be reached") from exc


def _get_json(url: str, body: dict[str, Any] | None = None) -> Any:
    try:
        return json.loads(_get(url, body))
    except ValueError as exc:
        raise SourceError("unexpected answer") from exc


def plain_text(html: str) -> str:
    """Page or rich text to readable text."""
    text = re.sub(r"(?is)<(script|style)\b.*?</\1\s*>", " ", html or "")
    text = re.sub(r"(?i)<(br|/p|/li|/h\d|/div)\b[^>]*>", "\n", text)
    text = unescape(re.sub(r"<[^>]+>", " ", text))
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    return re.sub(r"\s*\n\s*", "\n", text).strip()


def safe_url(url: str) -> str:
    """Only web links get shown: a page can't plant a javascript: link in the list."""
    url = unescape((url or "").strip())
    return url if re.match(r"https?://[^\s\"'<>]+$", url, re.I) else ""


def _day(value: Any) -> str:
    """YYYY-MM-DD from an ISO timestamp, or from "January 4, 2025" as visajobs writes its older postings."""
    text = str(value or "").strip()
    if re.match(r"\d{4}-\d{2}-\d{2}", text):
        return text[:10]
    try:
        return datetime.strptime(text, "%B %d, %Y").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def _company(slug: str) -> str:
    return _COMPANY_NAMES.get(slug, slug.title())


def country_of(location: str) -> str:
    for code, pattern in _COUNTRIES.items():
        if pattern.search(location or ""):
            return code
    return ""


def job_role(title: str) -> str:
    """"fullstack" for a full-stack title that names no front-end work, else "frontend". "Fullstack React Developer" or
    "Frontend/Fullstack" stay front-end: they were always shown. The page hides full-stack unless you ask for it, and
    only then are they assessed."""
    title = title or ""
    return "fullstack" if _FULLSTACK.search(title) and not _FRONTEND.search(title) else "frontend"


def is_frontend_title(title: str) -> bool:
    return bool(_FRONTEND.search(title)) and not _NOT_THE_ROLE.search(title)


def is_candidate_title(title: str) -> bool:
    """Worth a look: a front-end or full-stack title, or a generic engineering one whose ad may be front-end."""
    if is_wanted_title(title):
        return True
    return bool(_GENERIC.search(title)) and not _OTHER_SPECIALTY.search(title) and not _NOT_THE_ROLE.search(title)


def _signal(match: str) -> str:
    m = match.lower().replace(" ", "").replace("-", "")
    return "frontend" if m.startswith("frontend") else re.sub(r"\.?js$", "", m) if m not in ("javascript", "nextjs", "next.js") else m


def description_role(text: str) -> str | None:
    """What the ad's text says a generic title is: "frontend", "fullstack" (more back-end stack than front-end), or None
    when front-end isn't really part of it. It takes "front-end" written out, or two front-end technologies."""
    fe = {_signal(m.group(0)) for m in _FE_SIGNAL.finditer(text or "")}
    # "Frontend" in passing, or HTML and CSS, turn up in all sorts of ads (a CMS job, a Node back end): a modern
    # framework or TypeScript has to be named.
    if not fe & _FE_CORE:
        return None
    be = {m.group(0).lower() for m in _BE_SIGNAL.finditer(text or "")}
    return "fullstack" if len(be) > len(fe) else "frontend"


def is_wanted_title(title: str) -> bool:
    """Front-end roles, and full-stack ones (kept apart by job_role)."""
    return (bool(_FRONTEND.search(title)) or bool(_FULLSTACK.search(title))) and not _NOT_THE_ROLE.search(title)


def is_recent(posted: str, today: datetime | None = None) -> bool:
    if not posted:
        return True  # undated: let the reader judge
    try:
        day = datetime.strptime(posted, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return (today or datetime.now(timezone.utc)) - day <= timedelta(days=_MAX_AGE_DAYS)


def dedupe_key(company: str, title: str, country: str) -> str:
    """The same vacancy on two sites: same company, role and country, however it's punctuated."""
    def norm(text: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", (text or "").lower())
    return f"{norm(company)}|{norm(title)}|{country}"


def written_in_local_language(text: str) -> bool:
    """An ad written in Dutch, Norwegian or Danish expects that language, so there's no need to spend AI on it."""
    words = re.findall(r"[a-zæøåéö]+", (text or "")[:4000].lower())
    if len(words) < 30:
        return False
    local = sum(w in _LOCAL_WORDS and w not in _ENGLISH_WORDS for w in words)
    english = sum(w in _ENGLISH_WORDS for w in words)
    return local >= 15 and local > english * 1.2


# ---- Company career APIs ----


def parse_greenhouse(slug: str, data: dict[str, Any]) -> list[RawJob]:
    jobs = []
    for j in data.get("jobs") or []:
        location = str((j.get("location") or {}).get("name") or "")
        title, country = str(j.get("title") or "").strip(), country_of(location)
        if not country or not is_candidate_title(title):
            continue
        jobs.append(RawJob(
            source="greenhouse",
            external_id=f"{slug}:{j.get('id')}",
            title=title,
            company=_company(slug) if slug in _COMPANY_NAMES else str(j.get("company_name") or _company(slug)),
            location=location,
            country=country,
            url=safe_url(str(j.get("absolute_url") or "")),
            posted=_day(j.get("first_published") or j.get("updated_at")),
            detail={"kind": "greenhouse", "slug": slug, "id": str(j.get("id"))},
        ))
    return jobs


def parse_ashby(slug: str, data: dict[str, Any]) -> list[RawJob]:
    jobs = []
    for j in data.get("jobs") or []:
        if j.get("isListed") is False:
            continue
        places = [str(j.get("location") or "")] + [str(p.get("location") or "") for p in j.get("secondaryLocations") or []]
        match = next((p for p in places if country_of(p)), "")
        title = str(j.get("title") or "").strip()
        if not match or not is_candidate_title(title):
            continue
        jobs.append(RawJob(
            source="ashby",
            external_id=f"{slug}:{j.get('id')}",
            title=title,
            company=_company(slug),
            location=", ".join(p for p in places if p),
            country=country_of(match),
            url=safe_url(str(j.get("jobUrl") or "")),
            posted=_day(j.get("publishedAt")),
            description=plain_text(str(j.get("descriptionPlain") or j.get("descriptionHtml") or ""))[:DESCRIPTION_LIMIT],
        ))
    return jobs


def parse_lever(slug: str, data: list[dict[str, Any]]) -> list[RawJob]:
    jobs = []
    for j in data or []:
        cats = j.get("categories") or {}
        places = [str(cats.get("location") or "")] + [str(p) for p in cats.get("allLocations") or []]
        match = next((p for p in places if country_of(p)), "")
        title = str(j.get("text") or "").strip()
        if not match or not is_candidate_title(title):
            continue
        created = j.get("createdAt")
        posted = datetime.fromtimestamp(created / 1000, timezone.utc).strftime("%Y-%m-%d") if isinstance(created, (int, float)) else ""
        lists = " ".join(f"{x.get('text', '')}: {plain_text(str(x.get('content', '')))}" for x in j.get("lists") or [])
        jobs.append(RawJob(
            source="lever",
            external_id=f"{slug}:{j.get('id')}",
            title=title,
            company=_company(slug),
            location=", ".join(dict.fromkeys(p for p in places if p)),
            country=country_of(match),
            url=safe_url(str(j.get("hostedUrl") or "")),
            posted=posted,
            description=f"{j.get('descriptionPlain') or ''}\n{lists}".strip()[:DESCRIPTION_LIMIT],
        ))
    return jobs


def parse_recruitee(slug: str, data: dict[str, Any]) -> list[RawJob]:
    jobs = []
    for o in data.get("offers") or []:
        location = ", ".join(filter(None, [str(o.get("city") or ""), str(o.get("country") or "")])) or str(o.get("location") or "")
        title, country = str(o.get("title") or "").strip(), country_of(location)
        if not country or not is_candidate_title(title):
            continue
        body = f"{o.get('description') or ''}\n{o.get('requirements') or ''}"
        jobs.append(RawJob(
            source="recruitee",
            external_id=f"{slug}:{o.get('id')}",
            title=title,
            company=_company(slug) if slug in _COMPANY_NAMES else str(o.get("company_name") or _company(slug)),
            location=location,
            country=country,
            url=safe_url(str(o.get("careers_url") or "")),
            posted=_day(o.get("published_at")),
            description=plain_text(body)[:DESCRIPTION_LIMIT],
        ))
    return jobs


def parse_smartrecruiters(slug: str, data: dict[str, Any]) -> list[RawJob]:
    jobs = []
    for j in data.get("content") or []:
        place = j.get("location") or {}
        location = str(place.get("fullLocation") or ", ".join(filter(None, [str(place.get("city") or ""), str(place.get("country") or "")])))
        code = str(place.get("country") or "").upper()
        country = {"NL": "NL", "NO": "NO", "DK": "DK"}.get(code) or country_of(location)
        title = str(j.get("name") or "").strip()
        if not country or not is_candidate_title(title):
            continue
        jobs.append(RawJob(
            source="smartrecruiters",
            external_id=f"{slug}:{j.get('id')}",
            title=title,
            company=_company(slug) if slug in _COMPANY_NAMES else str((j.get("company") or {}).get("name") or _company(slug)),
            location=location,
            country=country,
            url=f"https://jobs.smartrecruiters.com/{quote(slug, safe='')}/{quote(str(j.get('id')), safe='')}",
            posted=_day(j.get("releasedDate")),
            detail={"kind": "smartrecruiters", "slug": slug, "id": str(j.get("id"))},
        ))
    return jobs


def parse_workable(slug: str, data: dict[str, Any]) -> list[RawJob]:
    jobs = []
    for j in data.get("jobs") or []:
        location = ", ".join(filter(None, [str(j.get("city") or ""), str(j.get("country") or "")]))
        title, country = str(j.get("title") or "").strip(), country_of(location)
        if not country or not is_candidate_title(title):
            continue
        jobs.append(RawJob(
            source="workable",
            external_id=f"{slug}:{j.get('shortcode')}",
            title=title,
            company=str(data.get("name") or slug.title()),
            location=location,
            country=country,
            url=safe_url(str(j.get("url") or j.get("application_url") or "")),
            posted=_day(j.get("published_on")),
            description=plain_text(str(j.get("description") or ""))[:DESCRIPTION_LIMIT],
        ))
    return jobs


def fetch_company_boards() -> tuple[list[RawJob], SourceResult]:
    def one(item: tuple[str, str]) -> list[RawJob]:
        kind, slug = item
        if kind == "greenhouse":
            return parse_greenhouse(slug, _get_json(f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs"))
        if kind == "ashby":
            return parse_ashby(slug, _get_json(f"https://api.ashbyhq.com/posting-api/job-board/{slug}"))
        if kind == "lever-eu":
            return parse_lever(slug, _get_json(f"https://api.eu.lever.co/v0/postings/{slug}?mode=json"))
        if kind == "recruitee":
            return parse_recruitee(slug, _get_json(f"https://{slug}.recruitee.com/api/offers/"))
        if kind == "smartrecruiters":
            return parse_smartrecruiters(slug, _get_json(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=100"))
        if kind == "workable":
            return parse_workable(slug, _get_json(f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true"))
        return parse_lever(slug, _get_json(f"https://api.lever.co/v0/postings/{slug}?mode=json"))

    def safely(item: tuple[str, str]) -> list[RawJob] | None:
        try:
            return one(item)
        except (SourceError, AttributeError, TypeError, KeyError, ValueError):
            return None

    items = [
        *(("greenhouse", s) for s in GREENHOUSE),
        *(("ashby", s) for s in ASHBY),
        *(("lever", s) for s in LEVER),
        *(("lever-eu", s) for s in LEVER_EU),
        *(("recruitee", s) for s in RECRUITEE),
        *(("smartrecruiters", s) for s in SMARTRECRUITERS),
        *(("workable", s) for s in WORKABLE),
    ]
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(safely, items))
    jobs = keep_relevant([job for r in results if r for job in r])
    failed = [slug for (_, slug), r in zip(items, results) if r is None]
    return jobs, SourceResult(
        "companies",
        ok=len(failed) < len(items),
        found=len(jobs),
        error=f"{len(failed)} of {len(items)} didn't answer: {', '.join(failed)}" if failed else "",
    )


def keep_relevant(jobs: list[RawJob]) -> list[RawJob]:
    """Front-end and full-stack titles stay. A generic title stays only if its ad is front-end work, read from the
    list's text or, when the list has none, from the ad itself (a few dozen per refresh at most)."""
    generic = [j for j in jobs if not is_wanted_title(j.title)]
    need = [j for j in generic if len(j.description) < 200 and j.detail][:_DETAIL_BUDGET]

    def fill(job: RawJob) -> None:
        try:
            extra = load_detail(job.detail)
        except (SourceError, KeyError, TypeError, AttributeError, ValueError):
            return
        job.description = str(extra.get("description") or job.description)
        if extra.get("company"):
            job.company = str(extra["company"])

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(fill, need))
    kept = []
    for job in jobs:
        if is_wanted_title(job.title):
            kept.append(job)
        elif role := description_role(job.description):
            job.role, job.by_description = role, True
            kept.append(job)
    return kept


# ---- EURES: Europe's public job portal. Its Dutch ads hide the employer, so the sponsor registers can't help with them ----


def parse_eures(data: dict[str, Any]) -> list[RawJob]:
    jobs = []
    for j in data.get("jvs") or []:
        title = re.sub(r"\s*&\w+;?$", "", plain_text(str(j.get("title") or "")))  # some end in a cut-off "&ndash"
        job_id = str(j.get("id") or "")
        if not job_id or "NL" not in (j.get("locationMap") or {}) or not is_candidate_title(title) or _DEAD_TECH.search(title):
            continue
        created = j.get("creationDate")
        jobs.append(RawJob(
            source="eures",
            external_id=job_id,
            title=title,
            company=str((j.get("employer") or {}).get("name") or "").strip(),
            location="Netherlands",
            country="NL",
            url=f"https://europa.eu/eures/portal/jv-se/jv-details/{quote(job_id, safe='')}?lang=en",
            posted=datetime.fromtimestamp(created / 1000, timezone.utc).strftime("%Y-%m-%d") if isinstance(created, (int, float)) else "",
            description=plain_text(str(j.get("description") or ""))[:DESCRIPTION_LIMIT],
        ))
    return jobs


def fetch_eures() -> list[RawJob]:
    """Only the Netherlands: the search adds nothing in Denmark, and in Norway it repeats NAV."""
    jobs: list[RawJob] = []
    for page in range(1, _EURES_PAGES + 1):
        if page > 1:
            time.sleep(_EURES_PAUSE_SECONDS)
        data = _get_json("https://europa.eu/eures/api/jv-searchengine/public/jv-search/search", {
            "resultsPerPage": _EURES_PAGE_SIZE, "page": page, "sortSearch": "BEST_MATCH",
            "keywords": [{"keyword": "frontend developer", "specificSearchCode": "EVERYWHERE"}],
            "publicationPeriod": None, "occupationUris": [], "skillUris": [], "requiredExperienceCodes": [],
            "positionScheduleCodes": [], "sectorCodes": [], "educationAndQualificationLevelCodes": [],
            "positionOfferingCodes": [], "locationCodes": ["nl"], "euresFlagCodes": [], "otherBenefitsCodes": [],
            "requiredLanguages": [], "minNumberPost": None, "sessionId": "olivia",
        })
        jobs += keep_relevant(parse_eures(data))
        if len(data.get("jvs") or []) < _EURES_PAGE_SIZE:
            break
    return jobs


# ---- visajobs.xyz: every card is in the page ----


def parse_visajobs(html: str) -> list[RawJob]:
    jobs = []
    for block in re.findall(r'<div class="job-card".*?(?=<div class="job-card"|\Z)', html, re.S):
        attr = lambda name: unescape((re.search(rf'data-{name}="([^"]*)"', block) or [None, ""])[1])  # noqa: E731
        location = re.sub(r"[^\w\s,.'-]", "", attr("location")).strip().title()
        country = country_of(location)
        title_link = re.search(r'<h3[^>]*>\s*<a href="([^"]+)"[^>]*>\s*(.*?)\s*</a>', block, re.S)
        if not country or not title_link:
            continue
        title = plain_text(title_link.group(2))
        if not is_wanted_title(title):
            continue
        company = re.search(r'</h3>\s*<p[^>]*>(.*?)</p>', block, re.S)
        apply = re.search(r'<a href="([^"]+)"[^>]*class="job-card-apply"', block)
        apply_url = safe_url(apply.group(1)) if apply else ""
        page = "https://visajobs.xyz" + title_link.group(1) if title_link.group(1).startswith("/") else ""
        badges = re.findall(r'class="badge [^"]*">([^<]+)', block)
        relocate = _RELOCATE_JOB.match(apply_url)
        jobs.append(RawJob(
            source="visajobs",
            external_id=title_link.group(1).strip("/").rsplit("/", 1)[-1],
            title=title,
            company=plain_text(company.group(1)) if company else attr("company").title(),
            location=location,
            country=country,
            url=apply_url or safe_url(page),
            posted=_day(attr("date")),
            relocation_stated=any("relocation" in b.lower() for b in badges),
            visa_stated=any("visa" in b.lower() for b in badges),
            detail={"kind": "relocate", "url": relocate.group(0)} if relocate else {},
        ))
    return jobs


def fetch_visajobs() -> list[RawJob]:
    return parse_visajobs(_get("https://visajobs.xyz/visa-sponsored-jobs/?q=frontend"))


# ---- relocate.me: its search needs a browser, its sitemap doesn't ----


def parse_relocate_sitemap(xml: str) -> list[RawJob]:
    jobs = []
    for url in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
        m = _RELOCATE_JOB.fullmatch(url.strip())
        if not m:
            continue
        country, city, company, slug, job_id = m.groups()
        title = re.sub(r"-\d+$", "", slug).replace("-", " ").title()
        if not is_wanted_title(title):
            continue
        jobs.append(RawJob(
            source="relocate",
            external_id=job_id,
            title=title,
            company=company.replace("-", " ").title(),
            location=f"{city.replace('-', ' ').title()}, {country.title()}",
            country=_RELOCATE_COUNTRY[country],
            url=m.group(0),
            relocation_stated=True,  # the site only lists jobs with relocation
            detail={"kind": "relocate", "url": m.group(0)},
        ))
    return jobs


def fetch_relocate() -> list[RawJob]:
    return parse_relocate_sitemap(_get("https://relocate.me/sitemap.xml"))


# ---- Norway's employment service, with its own filter for English as the working language ----


def parse_nav_list(html: str) -> list[RawJob]:
    jobs = []
    for job_id, raw_title in dict(re.findall(r'href="/stillinger/stilling/([0-9a-f-]{36})">([^<]+)</a>', html)).items():
        title = unescape(unescape(raw_title)).replace("\\", "").strip()
        # NAV's search has already chosen frontend roles, and titles are often in Norwegian: only drop the clear misses.
        if _NOT_THE_ROLE.search(title) or (_BACKEND.search(title) and not _FRONTEND.search(title)):
            continue
        jobs.append(RawJob(
            source="nav",
            external_id=job_id,
            title=title,
            company="",
            location="Norway",
            country="NO",
            url=f"https://arbeidsplassen.nav.no/stillinger/stilling/{job_id}",
            detail={"kind": "nav", "id": job_id},
        ))
    return jobs


def fetch_nav() -> list[RawJob]:
    return parse_nav_list(_get("https://arbeidsplassen.nav.no/stillinger?q=frontend&workLanguage=Engelsk"))


def parse_nav_detail(html: str) -> dict[str, Any]:
    text = plain_text(html)
    flat = re.sub(r"\s+", " ", text)
    employer = re.search(r"Arbeidsgiver (.+?) Sted ", flat)
    place = re.search(r" Sted (.+?) Om jobben", flat)
    language = re.search(r"Arbeidsspråk (.+?) (?:Vis flere|Søk|Sektor|Bransje)", flat)
    start = text.find("Om stillingen")
    body = text[start:] if start >= 0 else text
    result: dict[str, Any] = {"description": body[:DESCRIPTION_LIMIT]}
    if employer:
        result["company"] = employer.group(1)[:200]
    if place:
        result["location"] = place.group(1)[:200]
    if language and re.fullmatch(r"(?i)engelsk", language.group(1).strip()):
        result["english_stated"] = True
    return result


# ---- Full text, fetched when a job is about to be assessed ----


def parse_job_posting(html: str) -> dict[str, Any]:
    """A page's schema.org JobPosting, as relocate.me publishes it."""
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        if "JobPosting" not in block:
            continue
        try:
            data = json.loads(block, strict=False)
        except ValueError:
            continue
        if isinstance(data, dict):
            result: dict[str, Any] = {"description": plain_text(unescape(str(data.get("description") or "")))[:DESCRIPTION_LIMIT]}
            if _day(data.get("datePosted")):
                result["posted"] = _day(data.get("datePosted"))
            return result
    return {"description": plain_text(html)[:DESCRIPTION_LIMIT]}


def load_detail(detail: dict[str, str]) -> dict[str, Any]:
    """Fields to add to a job. `detail` was stored by a parser here, and each URL is rebuilt or checked against its host."""
    kind = detail.get("kind")
    if kind == "greenhouse":
        data = _get_json(f"https://boards-api.greenhouse.io/v1/boards/{quote(detail['slug'], safe='')}/jobs/{quote(detail['id'], safe='')}?content=true")
        result: dict[str, Any] = {"description": plain_text(unescape(str(data.get("content") or "")))[:DESCRIPTION_LIMIT]}
        if data.get("company_name"):
            result["company"] = str(data["company_name"])
        return result
    if kind == "smartrecruiters":
        data = _get_json(f"https://api.smartrecruiters.com/v1/companies/{quote(detail['slug'], safe='')}/postings/{quote(detail['id'], safe='')}")
        sections = ((data.get("jobAd") or {}).get("sections") or {}).values()
        return {"description": plain_text("\n".join(str(s.get("text") or "") for s in sections if isinstance(s, dict)))[:DESCRIPTION_LIMIT]}
    if kind == "nav" and _NAV_ID.match(detail.get("id", "")):
        return parse_nav_detail(_get(f"https://arbeidsplassen.nav.no/stillinger/stilling/{detail['id']}"))
    if kind == "relocate" and _RELOCATE_JOB.fullmatch(detail.get("url", "")):
        return parse_job_posting(_get(detail["url"]))
    return {}


def fetch_all() -> tuple[list[RawJob], list[SourceResult]]:
    """Richest sources first: when two list the same job, the first one's row stays and the others add to it."""
    def run(name: str, fetch: Any) -> tuple[list[RawJob], SourceResult]:
        try:
            jobs = fetch()
        except SourceError as exc:
            return [], SourceResult(name, ok=False, error=str(exc))
        return jobs, SourceResult(name, ok=True, found=len(jobs))

    with ThreadPoolExecutor(max_workers=5) as pool:
        boards = pool.submit(fetch_company_boards)
        relocate = pool.submit(run, "relocate", fetch_relocate)
        nav = pool.submit(run, "nav", fetch_nav)
        visa = pool.submit(run, "visajobs", fetch_visajobs)
        eures = pool.submit(run, "eures", fetch_eures)  # last: a job also on a company's own page keeps that fuller row
        parts = [boards.result(), relocate.result(), nav.result(), visa.result(), eures.result()]
    jobs: list[RawJob] = []
    for found, status in parts:
        usable = [job for job in found if job.url and is_recent(job.posted)]
        status.found = len(usable)  # what you'll actually see, not the closed postings a page still lists
        jobs += usable
    return jobs, [status for _, status in parts]
