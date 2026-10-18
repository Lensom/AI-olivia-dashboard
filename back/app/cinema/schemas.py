from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

CinemaKind = Literal["film", "tv", "cartoon", "animated_series", "anime", "show"]  # tv = series, show = TV shows
CinemaStatus = Literal["watched", "watching", "planned", "dropped"]


class CinemaTitle(BaseModel):
    id: str
    kind: CinemaKind = "film"
    title: str = ""
    original_title: str = ""
    recommended: bool = False
    genres: list[str] = Field(default_factory=list)
    status: CinemaStatus = "watched"
    score: float | None = None  # 0–10, your grade
    year: int | None = None  # release year
    view_year: int | None = None  # year you watched it
    studios: list[str] = Field(default_factory=list)
    actors: list[str] = Field(default_factory=list)
    directors: list[str] = Field(default_factory=list)  # director (films) or creators (series)
    poster: str = ""
    backdrop: str = ""
    overview: str = ""
    runtime: int | None = None  # minutes (films) or per episode (series)
    seasons: int | None = None  # total seasons released (TMDB)
    watched_seasons: int | None = None  # series: watched up to this season
    tmdb_id: int | None = None
    tmdb_media: Literal["movie", "tv", ""] = ""
    tmdb_rating: float | None = None
    imdb_id: str = ""  # tt…
    imdb_rating: float | None = None  # global IMDb rating, from IMDb's daily public dataset
    imdb_votes: int | None = None
    notes: str = ""
    added_at: str = ""  # ISO date


class CinemaListEntry(BaseModel):
    id: str
    title_id: str = ""  # a title from your library, or empty for a free-text entry
    text: str = ""  # free text (a franchise, a character…), or the title's name kept in case it's deleted
    note: str = ""


class CinemaList(BaseModel):
    """A ranked list you curate on the Tops page (e.g. "Топ фільмів", "Кращі злодеї")."""

    id: str
    title: str = ""
    size: int = 5  # slots shown, empty ones as "—"
    entries: list[CinemaListEntry] = Field(default_factory=list)


class CinemaData(BaseModel):
    items: list[CinemaTitle] = Field(default_factory=list)
    language: str = "uk-UA"  # TMDB language for titles, genres and descriptions
    lists: list[CinemaList] = Field(default_factory=list)


class CinemaResponse(CinemaData):
    updated_at: str | None = None
    tmdb_enabled: bool = False


class CinemaSearchResult(BaseModel):
    tmdb_id: int
    tmdb_media: Literal["movie", "tv"]
    title: str
    original_title: str = ""
    year: int | None = None
    poster: str = ""
    overview: str = ""
    tmdb_rating: float | None = None
    animation: bool = False
    original_language: str = ""
    votes: int = 0  # TMDB vote count, used to prefer the well-known title over namesakes


class CinemaDetails(BaseModel):
    """TMDB facts for one title, shaped like the CinemaTitle fields they fill."""

    tmdb_id: int
    tmdb_media: Literal["movie", "tv"]
    title: str
    original_title: str = ""
    year: int | None = None
    genres: list[str] = Field(default_factory=list)
    studios: list[str] = Field(default_factory=list)
    actors: list[str] = Field(default_factory=list)
    directors: list[str] = Field(default_factory=list)
    poster: str = ""
    backdrop: str = ""
    overview: str = ""
    runtime: int | None = None
    seasons: int | None = None
    tmdb_rating: float | None = None
    imdb_id: str = ""
    imdb_rating: float | None = None
    imdb_votes: int | None = None


class CinemaImdbRating(BaseModel):
    imdb_id: str = ""
    imdb_rating: float | None = None
    imdb_votes: int | None = None


class CinemaImportResponse(BaseModel):
    rows: list[CinemaTitle]
    skipped: int = 0
