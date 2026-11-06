"""Official registers of companies allowed to sponsor work visas: IND (Netherlands) and SIRI's fast-track list (Denmark).

Norway has no such list. Being listed means a company can sponsor, not that it will for a given role. Not being listed
says little: the legal entity may have another name, and in Denmark there are other routes than fast-track."""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from typing import Any

from app.jobs.sources import SourceError, SourceResult, _get, plain_text

_REGISTERS = {
    "NL": ("IND", "https://ind.nl/en/public-register-recognised-sponsors/public-register-work"),
    "DK": ("SIRI", "https://www.nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies"),
}
_MIN_COMPANIES = 100  # fewer: the page changed, and that mustn't read as every company having lost its status

# Words that don't tell companies apart, only ever dropped from the end: "Picnic Technologies B.V." is Picnic.
_NOISE = frozenset(
    """bv nv as aps is ps ab gmbh ltd limited inc llc plc holding holdings group international global
    technologies technology tech netherlands nederland europe benelux denmark danmark""".split()
)
_CELL = re.compile(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>")
_ROW = re.compile(r"(?is)<tr\b.*?</tr>")
_NUMBER = re.compile(r"\d[\d\s-]*")


def company_key(name: str) -> str:
    """The comparable part of a company's name, or "" when too little is left to compare safely."""
    text = re.sub(r"[./']", "", unescape(name or "").casefold()).replace("&", " and ")
    words = re.sub(r"[^\w]+", " ", text).split()
    while words and words[-1] in _NOISE:
        words.pop()
    key = " ".join(words)
    return key if len(key) >= 3 else ""


def parse_register(html: str) -> dict[str, str]:
    """Comparable name → official name, from a table of company and registration number. Both registers have that shape."""
    companies: dict[str, str] = {}
    for row in _ROW.findall(html):
        cells = [plain_text(c) for c in _CELL.findall(row)]
        if len(cells) >= 2 and cells[0] and _NUMBER.fullmatch(cells[1]):
            key = company_key(cells[0])
            if key:
                companies.setdefault(key, cells[0])
    if len(companies) < _MIN_COMPANIES:
        raise SourceError("unexpected answer")
    return companies


def fetch_registers() -> tuple[dict[str, dict[str, str]], list[SourceResult]]:
    """The registers that answered, by country, and what happened with each."""

    def one(item: tuple[str, tuple[str, str]]) -> tuple[str, dict[str, str] | None, SourceResult]:
        country, (name, url) = item
        try:
            companies = parse_register(_get(url))
        except SourceError as exc:
            return country, None, SourceResult(name.lower(), ok=False, error=str(exc))
        return country, companies, SourceResult(name.lower(), ok=True, found=len(companies))

    with ThreadPoolExecutor(max_workers=2) as pool:
        parts = list(pool.map(one, _REGISTERS.items()))
    return {country: companies for country, companies, _ in parts if companies is not None}, [status for _, _, status in parts]


def sponsor_for(data: dict[str, Any], registers: dict[str, dict[str, str]]) -> dict[str, str] | None:
    """What a vacancy's `sponsor` should be. Call only for a country whose register is in `registers`."""
    country = data.get("country", "")
    official = registers[country].get(company_key(data.get("company", "")))
    return {"name": official, "registry": _REGISTERS[country][0]} if official else None
