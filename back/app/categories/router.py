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


# Each section's menu, in the same names and order as its frontend nav (front/src/features/*/nav.ts).
_DEFAULTS: dict[str, list[tuple[str, str]]] = {
    "investing": [
        ("Overview", "dashboard"),
        ("Portfolio", "table"),
        ("Watchlist", "picking"),
        ("Finance", "finance"),
        ("Activities", "activities"),
        ("Analytics", "analytics"),
        ("Calendar", "calendar"),
        ("Notes", "notes"),
        ("Crypto", "crypto"),
        ("Total", "total"),
    ],
    "cinematography": [
        ("Films", "films"),
        ("Series", "series"),
        ("Cartoons", "cartoons"),
        ("Animated series", "animated-series"),
        ("Anime", "anime"),
        ("TV shows", "tv-shows"),
        ("Coming up", "upcoming"),
        ("Year in film", "year"),
        ("People", "people"),
        ("Achievements", "achievements"),
        ("Franchises", "franchises"),
        ("Tops", "tops"),
    ],
    "library": [
        ("Books", "books"),
        ("Comics", "comics"),
        ("Manga", "manga"),
        ("Magazines", "magazines"),
        ("Achievements", "achievements"),
        ("Book series", "series"),
        ("Tops", "tops"),
    ],
    "life": [("Tasks", "tasks"), ("Games", "games"), ("Career", "career"), ("Collecting", "collection"), ("Must visit", "places"), ("Improvements", "improvements")],
}
# Investing rows created with the old default names are renamed; names the user changed are left alone.
_LEGACY_NAMES = {"dashboard": ("Dashboard",), "table": ("Holdings",), "picking": ("Picking", "Allocation rules")}

# (id, category_id, name, slug, sort_order)
SubRow = tuple[int, int, str, str, int]


def _category_slug(conn: Connection, *, user_id: int, category_id: int) -> str:
    """The category's slug; 404 when it isn't yours."""
    row = conn.execute("SELECT slug FROM categories WHERE id = %s AND user_id = %s", (category_id, user_id)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return row[0]


def _subcategory_rows(conn: Connection, *, user_id: int, category_id: int) -> list[SubRow]:
    return conn.execute(
        """
        SELECT id, category_id, name, slug, COALESCE(sort_order, 0)
        FROM subcategories
        WHERE user_id = %s AND category_id = %s
        ORDER BY sort_order ASC, id ASC
        """,
        (user_id, category_id),
    ).fetchall()


def _ensure_defaults(conn: Connection, *, user_id: int, category_id: int, slug: str, rows: list[SubRow]) -> bool:
    """Brings the menu up to date: renames, the moved Jobs entry, missing defaults, an order for old rows.

    Decided from the rows already read, so the usual case (nothing to do) costs no queries: this runs on every page
    load, and each query is a round trip to the database. Returns whether anything was written (not yet committed)."""
    by_slug = {r[3]: r for r in rows}
    changed = False
    if slug == "investing":
        for s, old_names in _LEGACY_NAMES.items():
            row = by_slug.get(s)
            new_name = next(n for n, d in _DEFAULTS["investing"] if d == s)
            if row and row[2] in old_names:
                conn.execute("UPDATE subcategories SET name = %s WHERE id = %s", (new_name, row[0]))
                changed = True
    if slug == "cinematography" and "series" not in by_slug and "tv-shows" in by_slug:
        # "TV shows" used to be the series page: it becomes "Series", and tv-shows is now for TV shows proper.
        conn.execute("UPDATE subcategories SET name = 'Series', slug = 'series' WHERE id = %s", (by_slug["tv-shows"][0],))
        by_slug["series"] = by_slug.pop("tv-shows")
        changed = True
    if slug == "life" and "jobs" in by_slug:
        # Jobs became a tab of Career: its own menu entry goes. Only the entry; the vacancies stay.
        conn.execute("DELETE FROM subcategories WHERE id = %s", (by_slug.pop("jobs")[0],))
        changed = True

    missing = [(name, s) for name, s in _DEFAULTS.get(slug, []) if s not in by_slug]
    if missing:
        top = max((r[4] for r in by_slug.values()), default=0)
        with conn.cursor() as cur:
            # One round trip for all of them; a page loading in two tabs at once must not trip over the other's rows.
            cur.executemany(
                """
                INSERT INTO subcategories(user_id, category_id, name, slug, sort_order)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (category_id, slug) DO NOTHING
                """,
                [(user_id, category_id, name, s, top + 10 * (i + 1)) for i, (name, s) in enumerate(missing)],
            )
        changed = True
    elif by_slug and all(r[4] == 0 for r in by_slug.values()):
        # Rows from before sort_order existed: give them an order, oldest first.
        conn.execute(
            """
            UPDATE subcategories AS s SET sort_order = o.n * 10
            FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM subcategories
                  WHERE user_id = %s AND category_id = %s) AS o
            WHERE s.id = o.id
            """,
            (user_id, category_id),
        )
        changed = True
    return changed


@router.get("/{category_id}/subcategories", response_model=list[SubcategoryResponse])
def list_subcategories(
    category_id: int,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    slug = _category_slug(conn, user_id=user.id, category_id=category_id)
    rows = _subcategory_rows(conn, user_id=user.id, category_id=category_id)
    if _ensure_defaults(conn, user_id=user.id, category_id=category_id, slug=slug, rows=rows):
        conn.commit()
        rows = _subcategory_rows(conn, user_id=user.id, category_id=category_id)
    return [_sub_response(r) for r in rows]


@router.get("/subcategories", response_model=dict[int, list[SubcategoryResponse]])
def list_all_subcategories(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """The whole menu at once, by category id: one request (and two queries) on every page load instead of one each."""

    def read() -> tuple[list[tuple[int, str]], dict[int, list[SubRow]]]:
        cats = conn.execute("SELECT id, slug FROM categories WHERE user_id = %s", (user.id,)).fetchall()
        rows = conn.execute(
            """
            SELECT id, category_id, name, slug, COALESCE(sort_order, 0) FROM subcategories
            WHERE user_id = %s ORDER BY sort_order ASC, id ASC
            """,
            (user.id,),
        ).fetchall()
        by_cat: dict[int, list[SubRow]] = {int(c[0]): [] for c in cats}
        for r in rows:
            by_cat.setdefault(int(r[1]), []).append(r)
        return cats, by_cat

    cats, by_cat = read()
    changed = False
    for cat_id, slug in cats:
        changed |= _ensure_defaults(conn, user_id=user.id, category_id=int(cat_id), slug=slug, rows=by_cat[int(cat_id)])
    if changed:
        conn.commit()
        cats, by_cat = read()
    return {cat_id: [_sub_response(r) for r in rows] for cat_id, rows in by_cat.items()}


def _sub_response(r: SubRow) -> SubcategoryResponse:
    return SubcategoryResponse(id=int(r[0]), category_id=int(r[1]), name=r[2], slug=r[3], sort_order=int(r[4]))


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

