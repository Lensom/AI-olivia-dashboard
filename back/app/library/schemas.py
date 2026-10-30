from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.cinema.schemas import CinemaList

LibraryKind = Literal["book", "comic", "manga", "magazine"]
LibraryStatus = Literal["read", "reading", "planned", "dropped"]
LibrarySource = Literal["openlibrary", "google", ""]


class LibraryItem(BaseModel):
    id: str
    kind: LibraryKind = "book"
    title: str = ""
    original_title: str = ""
    recommended: bool = False
    genres: list[str] = Field(default_factory=list)
    status: LibraryStatus = "read"
    score: float | None = None  # 1–5 stars, your grade
    authors: list[str] = Field(default_factory=list)
    finish_date: str = ""  # ISO date you finished it
    year: int | None = None  # first published
    pages: int | None = None
    publisher: str = ""
    cover: str = ""
    description: str = ""
    isbn: str = ""
    volumes_read: int | None = None  # comics / manga: read up to this volume
    volumes_total: int | None = None
    source: LibrarySource = ""
    source_id: str = ""  # Open Library work key (/works/OL…W) or Google Books volume id
    source_rating: float | None = None  # readers' average, out of 5
    source_votes: int | None = None
    notes: str = ""
    added_at: str = ""
    # Wikidata: the book's entity and the series it belongs to (see library/series.py)
    wikidata_id: str = ""
    series_id: str = ""
    series_name: str = ""
    wikidata_synced: str = ""  # ISO date of the last lookup


class LibraryData(BaseModel):
    items: list[LibraryItem] = Field(default_factory=list)
    lists: list[CinemaList] = Field(default_factory=list)  # Tops: same shape as Cinematography's


class LibraryResponse(LibraryData):
    updated_at: str | None = None
    google_enabled: bool = False


class LibraryDetails(BaseModel):
    """Facts from Open Library or Google Books, shaped like the LibraryItem fields they fill."""

    source: Literal["openlibrary", "google"]
    source_id: str
    title: str
    original_title: str = ""
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    pages: int | None = None
    publisher: str = ""
    genres: list[str] = Field(default_factory=list)
    cover: str = ""
    description: str = ""
    isbn: str = ""
    language: str = ""
    source_rating: float | None = None
    source_votes: int | None = None


class LibraryMatchRequest(BaseModel):
    id: str
    kind: LibraryKind = "book"
    title: str
    authors: list[str] = Field(default_factory=list)
    source: LibrarySource = ""
    source_id: str = ""


class LibraryImportResponse(BaseModel):
    rows: list[LibraryItem]
    skipped: int = 0


class LibraryWikidataRequest(BaseModel):
    id: str
    title: str
    original_title: str = ""
    authors: list[str] = Field(default_factory=list)
    source: LibrarySource = ""
    source_id: str = ""


class LibraryWikidata(BaseModel):
    """A book's Wikidata entity and its series; empty strings when none was found."""

    id: str
    wikidata_id: str = ""
    series_id: str = ""
    series_name: str = ""


class LibrarySeriesPart(BaseModel):
    wikidata_id: str
    title: str  # in the reader's language when Wikidata has it
    original_title: str = ""  # English
    author: str = ""
    year: int | None = None
    index: str = ""  # number in the series, when Wikidata gives one
    cover: str = ""
    ol_id: str = ""  # Open Library work key (/works/OL…W), to add it in one click


class LibrarySeries(BaseModel):
    id: str
    name: str
    parts: list[LibrarySeriesPart]
