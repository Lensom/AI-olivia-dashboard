"""Life → Improvements: habits and goals by area of life, each to do, in progress or done.

The page saves the whole list at once, as Must visit does: one JSON document per user. Nothing is built in: the
list is personal, so it starts empty and is filled on the page (or imported from JSON there)."""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse

router = APIRouter(prefix="/life/improvements", tags=["improvements"])

Status = Literal["todo", "in_progress", "done"]
Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
_WEB_LINK = re.compile(r"^https?://[^\s\"'<>]+$", re.I)


class Item(BaseModel):
    id: Id
    name: str = Field(min_length=1, max_length=300)
    details: str = Field(default="", max_length=2000)
    status: Status = "todo"
    links: list[Annotated[str, Field(max_length=2000)]] = Field(default_factory=list, max_length=20)
    note: str = Field(default="", max_length=4000)
    focus: bool = False  # pinned to "Focus now" at the top
    changed_at: str = Field(default="", max_length=40)  # when the status last changed (ISO), for "Recently done"

    @field_validator("links")
    @classmethod
    def _web_links(cls, v: list[str]) -> list[str]:
        # The page turns these into links: a javascript: one must never get in.
        out = [s.strip() for s in v if s and s.strip()]
        for s in out:
            if not _WEB_LINK.match(s):
                raise ValueError("a link must start with http:// or https://")
        return out


class Group(BaseModel):
    id: Id
    emoji: str = Field(default="", max_length=16)
    title: str = Field(min_length=1, max_length=150)
    items: list[Item] = Field(default_factory=list, max_length=200)


class Section(BaseModel):
    id: Id
    title: str = Field(min_length=1, max_length=150)
    groups: list[Group] = Field(default_factory=list, max_length=50)


class Improvements(BaseModel):
    sections: list[Section] = Field(default_factory=list, max_length=50)


class ImprovementsResponse(Improvements):
    updated_at: str | None = None


@router.get("", response_model=ImprovementsResponse)
def get_improvements(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute("SELECT data, updated_at FROM improvement_lists WHERE user_id = %s", (user.id,)).fetchone()
    if not row:
        return ImprovementsResponse()
    data: dict[str, Any] = row[0] if isinstance(row[0], dict) else {}
    return ImprovementsResponse(**Improvements(**data).model_dump(), updated_at=str(row[1]))


@router.put("", response_model=ImprovementsResponse)
def save_improvements(
    payload: Improvements,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute(
        """
        INSERT INTO improvement_lists(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(payload.model_dump())),
    ).fetchone()
    conn.commit()
    return ImprovementsResponse(**payload.model_dump(), updated_at=str(row[0]) if row else None)
