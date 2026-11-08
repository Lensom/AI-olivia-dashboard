"""Life → Collecting: what you collect, by category, with a status for each line and a list of what to buy.

The page saves the whole collection at once, as Games does: one JSON document per user."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse

router = APIRouter(prefix="/life/collection", tags=["collection"])

Status = Literal["idea", "collecting", "done", "dropped"]  # to decide · in progress · complete · decided against
Currency = Literal["UAH", "USD", "EUR"]
Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
_WEB_LINK = re.compile(r"^https?://[^\s\"'<>]+$", re.I)


def _link(v: str) -> str:
    """Only web links: the page turns this into a link, so a javascript: one must never get in."""
    v = (v or "").strip()
    if v and not _WEB_LINK.match(v):
        raise ValueError("a link must start with http:// or https://")
    return v


class Wish(BaseModel):
    """Something to buy for the collection."""

    id: Id
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(default="", max_length=2000)
    price: float | None = Field(default=None, ge=0, le=10_000_000)
    currency: Currency = "UAH"
    bought: bool = False

    _url = field_validator("url")(classmethod(lambda cls, v: _link(v)))


class Piece(BaseModel):
    """One line of a category, such as "Stephen King" under "KSD editions"."""

    id: Id
    title: str = Field(min_length=1, max_length=300)
    note: str = Field(default="", max_length=2000)
    url: str = Field(default="", max_length=2000)
    status: Status = "idea"
    count: int | None = Field(default=None, ge=0, le=1_000_000)  # how many you have
    goal: int | None = Field(default=None, ge=1, le=1_000_000)  # how many you want
    wishes: list[Wish] = Field(default_factory=list, max_length=200)

    _url = field_validator("url")(classmethod(lambda cls, v: _link(v)))


class Item(Piece):
    children: list[Piece] = Field(default_factory=list, max_length=100)  # one level, as in the Notion page


class Category(BaseModel):
    id: Id
    name: str = Field(min_length=1, max_length=100)
    items: list[Item] = Field(default_factory=list, max_length=300)


class Collection(BaseModel):
    categories: list[Category] = Field(default_factory=list, max_length=50)


class CollectionResponse(Collection):
    updated_at: str | None = None


@router.get("", response_model=CollectionResponse)
def get_collection(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute("SELECT data, updated_at FROM collection_lists WHERE user_id = %s", (user.id,)).fetchone()
    if not row:
        return CollectionResponse()
    return CollectionResponse(**Collection(**(row[0] if isinstance(row[0], dict) else {})).model_dump(), updated_at=str(row[1]))


@router.put("", response_model=CollectionResponse)
def save_collection(
    payload: Collection,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute(
        """
        INSERT INTO collection_lists(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(payload.model_dump())),
    ).fetchone()
    conn.commit()
    return CollectionResponse(**payload.model_dump(), updated_at=str(row[0]) if row else None)
