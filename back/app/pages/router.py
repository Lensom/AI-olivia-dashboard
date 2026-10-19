from __future__ import annotations

from typing import Annotated, Any, Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.auth.router import get_current_user, get_conn
from app.auth.schemas import UserResponse


router = APIRouter(prefix="/pages", tags=["pages"])

PageKind = Literal["doc", "table"]


class PageSummary(BaseModel):
    """A page in the tree, without its content."""

    id: str
    parent_id: str | None = None
    title: str = ""
    icon: str = ""
    kind: PageKind = "doc"
    sort_order: int = 0
    updated_at: str | None = None


class Page(PageSummary):
    # doc: BlockNote blocks; table: {"columns": [...], "sections": [...]}
    content: Any = None


class PageCreate(BaseModel):
    parent_id: str | None = None
    kind: PageKind = "doc"
    title: str = Field(default="", max_length=300)
    icon: str = Field(default="", max_length=16)
    content: Any = None


class PagePatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    icon: str | None = Field(default=None, max_length=16)
    content: Any = None
    # Moving: parent_id ("" or null = top level) and/or sort_order among the new siblings.
    parent_id: str | None = None
    sort_order: int | None = None


_COLS = "id, parent_id, title, icon, kind, sort_order, updated_at"


def _summary(r: tuple) -> PageSummary:
    return PageSummary(id=r[0], parent_id=r[1], title=r[2], icon=r[3], kind=r[4], sort_order=r[5], updated_at=str(r[6]))


def _owned(conn: Connection, user_id: int, page_id: str) -> None:
    if not conn.execute("SELECT 1 FROM life_pages WHERE id = %s AND user_id = %s", (page_id, user_id)).fetchone():
        raise HTTPException(status_code=404, detail="Page not found")


@router.get("", response_model=list[PageSummary])
def list_pages(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    rows = conn.execute(
        f"SELECT {_COLS} FROM life_pages WHERE user_id = %s ORDER BY sort_order, created_at",
        (user.id,),
    ).fetchall()
    return [_summary(r) for r in rows]


@router.post("", response_model=Page, status_code=201)
def create_page(
    payload: PageCreate,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    if payload.parent_id:
        _owned(conn, user.id, payload.parent_id)
    last = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) FROM life_pages WHERE user_id = %s AND parent_id IS NOT DISTINCT FROM %s",
        (user.id, payload.parent_id),
    ).fetchone()
    row = conn.execute(
        f"""
        INSERT INTO life_pages(id, user_id, parent_id, title, icon, kind, content, sort_order)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING {_COLS}
        """,
        (
            uuid.uuid4().hex,
            user.id,
            payload.parent_id,
            payload.title,
            payload.icon,
            payload.kind,
            Json(payload.content),
            int(last[0]) + 10 if last else 10,
        ),
    ).fetchone()
    conn.commit()
    return Page(**_summary(row).model_dump(), content=payload.content)


@router.get("/{page_id}", response_model=Page)
def get_page(
    page_id: str,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute(
        f"SELECT {_COLS}, content FROM life_pages WHERE id = %s AND user_id = %s", (page_id, user.id)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Page not found")
    return Page(**_summary(row).model_dump(), content=row[7])


@router.patch("/{page_id}", response_model=PageSummary)
def update_page(
    page_id: str,
    payload: PagePatch,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    _owned(conn, user.id, page_id)
    fields = payload.model_fields_set
    sets: list[str] = []
    args: list[object] = []
    if "title" in fields and payload.title is not None:
        sets.append("title = %s")
        args.append(payload.title)
    if "icon" in fields and payload.icon is not None:
        sets.append("icon = %s")
        args.append(payload.icon)
    if "content" in fields:
        sets.append("content = %s")
        args.append(Json(payload.content))
    if "parent_id" in fields:
        parent = payload.parent_id or None
        if parent:
            _owned(conn, user.id, parent)
            # A page can't move inside itself or one of its own subpages.
            cycle = conn.execute(
                """
                WITH RECURSIVE up(id, parent_id) AS (
                    SELECT id, parent_id FROM life_pages WHERE id = %s AND user_id = %s
                    UNION ALL
                    SELECT p.id, p.parent_id FROM life_pages p JOIN up ON p.id = up.parent_id
                )
                SELECT 1 FROM up WHERE id = %s
                """,
                (parent, user.id, page_id),
            ).fetchone()
            if cycle:
                raise HTTPException(status_code=400, detail="A page can't be moved inside itself.")
        sets.append("parent_id = %s")
        args.append(parent)
    if "sort_order" in fields and payload.sort_order is not None:
        sets.append("sort_order = %s")
        args.append(payload.sort_order)
    if not sets:
        return _summary(conn.execute(f"SELECT {_COLS} FROM life_pages WHERE id = %s", (page_id,)).fetchone())
    row = conn.execute(
        f"UPDATE life_pages SET {', '.join(sets)}, updated_at = NOW() WHERE id = %s AND user_id = %s RETURNING {_COLS}",
        (*args, page_id, user.id),
    ).fetchone()
    conn.commit()
    return _summary(row)


@router.delete("/{page_id}", status_code=204)
def delete_page(
    page_id: str,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    _owned(conn, user.id, page_id)
    # Subpages go with their parent (ON DELETE CASCADE).
    conn.execute("DELETE FROM life_pages WHERE id = %s AND user_id = %s", (page_id, user.id))
    conn.commit()
