from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from psycopg import Connection

from app.auth.router import get_current_user, get_conn
from app.auth.schemas import UserResponse
from app.categories.schemas import (
    CategoryCreateRequest,
    CategoryResponse,
    SubcategoryCreateRequest,
    SubcategoryReorderRequest,
    SubcategoryResponse,
)


router = APIRouter(prefix="/categories", tags=["categories"])


_slug_re = re.compile(r"[^a-z0-9]+")


def slugify(name: str) -> str:
    base = name.strip().lower()
    base = _slug_re.sub("-", base).strip("-")
    return base or "category"


@router.get("", response_model=list[CategoryResponse])
def list_categories(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    rows = conn.execute(
        "SELECT id, name, slug FROM categories WHERE user_id = %s ORDER BY created_at DESC",
        (user.id,),
    ).fetchall()
    return [CategoryResponse(id=int(r[0]), name=r[1], slug=r[2]) for r in rows]


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: CategoryCreateRequest,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    base_slug = slugify(name)
    slug = base_slug

    # Simple unique slug per user.
    for i in range(0, 25):
        try:
            row = conn.execute(
                "INSERT INTO categories(user_id, name, slug) VALUES(%s, %s, %s) RETURNING id",
                (user.id, name, slug),
            ).fetchone()
            conn.commit()
            return CategoryResponse(id=int(row[0]), name=name, slug=slug)
        except Exception:
            conn.rollback()
            slug = f"{base_slug}-{i+2}"

    raise HTTPException(status_code=409, detail="Could not create category (slug conflict)")


def _require_category_owner(conn: Connection, *, user_id: int, category_id: int) -> None:
    row = conn.execute(
        "SELECT 1 FROM categories WHERE id = %s AND user_id = %s",
        (category_id, user_id),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")


def _next_subcategory_sort_order(conn: Connection, *, user_id: int, category_id: int) -> int:
    row = conn.execute(
        """
        SELECT COALESCE(MAX(sort_order), 0)
        FROM subcategories
        WHERE user_id = %s AND category_id = %s
        """,
        (user_id, category_id),
    ).fetchone()
    return int(row[0]) + 10 if row and row[0] is not None else 10


def _backfill_subcategory_sort_orders_if_all_zero(
    conn: Connection, *, user_id: int, category_id: int
) -> None:
    agg = conn.execute(
        """
        SELECT COUNT(*) FILTER (WHERE COALESCE(sort_order, 0) = 0), COUNT(*)
        FROM subcategories
        WHERE user_id = %s AND category_id = %s
        """,
        (user_id, category_id),
    ).fetchone()
    if not agg or int(agg[1]) == 0:
        return
    if int(agg[0]) != int(agg[1]):
        return
    rows = conn.execute(
        """
        SELECT id FROM subcategories
        WHERE user_id = %s AND category_id = %s
        ORDER BY created_at ASC, id ASC
        """,
        (user_id, category_id),
    ).fetchall()
    for i, (sid,) in enumerate(rows):
        conn.execute(
            "UPDATE subcategories SET sort_order = %s WHERE id = %s AND user_id = %s",
            ((i + 1) * 10, int(sid), user_id),
        )
    conn.commit()


def _ensure_investing_defaults(conn: Connection, *, user_id: int, category_id: int) -> None:
    category = conn.execute(
        "SELECT slug FROM categories WHERE id = %s AND user_id = %s",
        (category_id, user_id),
    ).fetchone()
    if not category or category[0] != "investing":
        return

    # Same names and order as the frontend's Investing nav (front/src/features/investing/nav.ts).
    defaults = [
        ("Total", "total"),
        ("Overview", "dashboard"),
        ("Portfolio", "table"),
        ("Finance", "finance"),
        ("Allocation rules", "picking"),
        ("Activities", "activities"),
        ("Analytics", "analytics"),
        ("Notes", "notes"),
        ("Crypto", "crypto"),
    ]
    # Rows created with the old default names are renamed; names the user changed are left alone.
    legacy_names = {"dashboard": "Dashboard", "table": "Holdings", "picking": "Picking"}
    for name, slug in defaults:
        old = legacy_names.get(slug)
        if old:
            conn.execute(
                "UPDATE subcategories SET name = %s WHERE category_id = %s AND slug = %s AND name = %s",
                (name, category_id, slug, old),
            )
    for name, slug in defaults:
        exists = conn.execute(
            """
            SELECT 1 FROM subcategories
            WHERE category_id = %s AND slug = %s
            """,
            (category_id, slug),
        ).fetchone()
        if exists:
            continue
        if slug == "total":
            # Net worth sits above the Stocks pages, also for users whose menu existed before it.
            first = conn.execute(
                "SELECT COALESCE(MIN(sort_order), 10) FROM subcategories WHERE user_id = %s AND category_id = %s",
                (user_id, category_id),
            ).fetchone()
            ord_val = int(first[0]) - 10 if first and first[0] is not None else 0
        else:
            ord_val = _next_subcategory_sort_order(conn, user_id=user_id, category_id=category_id)
        conn.execute(
            """
            INSERT INTO subcategories(user_id, category_id, name, slug, sort_order)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (user_id, category_id, name, slug, ord_val),
        )
    conn.commit()


def _ensure_cinema_defaults(conn: Connection, *, user_id: int, category_id: int) -> None:
    category = conn.execute(
        "SELECT slug FROM categories WHERE id = %s AND user_id = %s",
        (category_id, user_id),
    ).fetchone()
    if not category or category[0] != "cinematography":
        return
    # Same names and order as the frontend's Cinematography nav (front/src/features/cinema/nav.ts).
    defaults = [
        ("Films", "films"),
        ("Series", "series"),
        ("Cartoons", "cartoons"),
        ("Animated series", "animated-series"),
        ("Anime", "anime"),
        ("TV shows", "tv-shows"),
        ("Tops", "tops"),
    ]
    # "TV shows" used to be the series page: it becomes "Series", and tv-shows is now for TV shows proper.
    has_series = conn.execute(
        "SELECT 1 FROM subcategories WHERE category_id = %s AND slug = 'series'", (category_id,)
    ).fetchone()
    if not has_series:
        conn.execute(
            "UPDATE subcategories SET name = 'Series', slug = 'series' WHERE category_id = %s AND slug = 'tv-shows'",
            (category_id,),
        )
    for name, slug in defaults:
        exists = conn.execute(
            "SELECT 1 FROM subcategories WHERE category_id = %s AND slug = %s",
            (category_id, slug),
        ).fetchone()
        if exists:
            continue
        conn.execute(
            """
            INSERT INTO subcategories(user_id, category_id, name, slug, sort_order)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (user_id, category_id, name, slug, _next_subcategory_sort_order(conn, user_id=user_id, category_id=category_id)),
        )
    conn.commit()


def _ensure_library_defaults(conn: Connection, *, user_id: int, category_id: int) -> None:
    category = conn.execute(
        "SELECT slug FROM categories WHERE id = %s AND user_id = %s",
        (category_id, user_id),
    ).fetchone()
    if not category or category[0] != "library":
        return
    # Same names and order as the frontend's Library nav (front/src/features/library/nav.ts).
    defaults = [("Books", "books"), ("Comics", "comics"), ("Manga", "manga"), ("Magazines", "magazines"), ("Tops", "tops")]
    for name, slug in defaults:
        exists = conn.execute(
            "SELECT 1 FROM subcategories WHERE category_id = %s AND slug = %s",
            (category_id, slug),
        ).fetchone()
        if exists:
            continue
        conn.execute(
            """
            INSERT INTO subcategories(user_id, category_id, name, slug, sort_order)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (user_id, category_id, name, slug, _next_subcategory_sort_order(conn, user_id=user_id, category_id=category_id)),
        )
    conn.commit()


@router.get("/{category_id}/subcategories", response_model=list[SubcategoryResponse])
def list_subcategories(
    category_id: int,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    _require_category_owner(conn, user_id=user.id, category_id=category_id)
    _ensure_investing_defaults(conn, user_id=user.id, category_id=category_id)
    _ensure_cinema_defaults(conn, user_id=user.id, category_id=category_id)
    _ensure_library_defaults(conn, user_id=user.id, category_id=category_id)
    _backfill_subcategory_sort_orders_if_all_zero(conn, user_id=user.id, category_id=category_id)
    rows = conn.execute(
        """
        SELECT id, category_id, name, slug, sort_order
        FROM subcategories
        WHERE user_id = %s AND category_id = %s
        ORDER BY sort_order ASC, id ASC
        """,
        (user.id, category_id),
    ).fetchall()
    return [
        SubcategoryResponse(
            id=int(r[0]),
            category_id=int(r[1]),
            name=r[2],
            slug=r[3],
            sort_order=int(r[4] if r[4] is not None else 0),
        )
        for r in rows
    ]


@router.post("/{category_id}/subcategories", response_model=SubcategoryResponse, status_code=status.HTTP_201_CREATED)
def create_subcategory(
    category_id: int,
    payload: SubcategoryCreateRequest,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    _require_category_owner(conn, user_id=user.id, category_id=category_id)
    name = payload.name.strip()
    base_slug = slugify(name)
    slug = base_slug

    next_ord = conn.execute(
        """
        SELECT COALESCE(MAX(sort_order), 0) + 10
        FROM subcategories
        WHERE user_id = %s AND category_id = %s
        """,
        (user.id, category_id),
    ).fetchone()
    ord_val = int(next_ord[0]) if next_ord and next_ord[0] is not None else 10

    for i in range(0, 25):
        try:
            row = conn.execute(
                """
                INSERT INTO subcategories(user_id, category_id, name, slug, sort_order)
                VALUES(%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (user.id, category_id, name, slug, ord_val),
            ).fetchone()
            conn.commit()
            return SubcategoryResponse(
                id=int(row[0]), category_id=category_id, name=name, slug=slug, sort_order=ord_val
            )
        except Exception:
            conn.rollback()
            slug = f"{base_slug}-{i+2}"

    raise HTTPException(status_code=409, detail="Could not create subcategory (slug conflict)")


@router.put("/{category_id}/subcategories/reorder", response_model=list[SubcategoryResponse])
def reorder_subcategories(
    category_id: int,
    payload: SubcategoryReorderRequest,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    _require_category_owner(conn, user_id=user.id, category_id=category_id)
    ordered = list(dict.fromkeys(payload.ordered_ids))
    if len(ordered) != len(payload.ordered_ids):
        raise HTTPException(status_code=400, detail="Duplicate ids in ordered_ids")

    rows = conn.execute(
        """
        SELECT id FROM subcategories
        WHERE user_id = %s AND category_id = %s
        """,
        (user.id, category_id),
    ).fetchall()
    existing = {int(r[0]) for r in rows}
    if set(ordered) != existing:
        raise HTTPException(
            status_code=400,
            detail="ordered_ids must contain exactly each subcategory id for this category",
        )

    for idx, sid in enumerate(ordered):
        conn.execute(
            """
            UPDATE subcategories
            SET sort_order = %s
            WHERE id = %s AND user_id = %s AND category_id = %s
            """,
            ((idx + 1) * 10, sid, user.id, category_id),
        )
    conn.commit()

    return list_subcategories(category_id, user, conn)

