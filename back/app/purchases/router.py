"""Life → Purchases: what you plan to buy and what you bought, in lists (General, Tech, Books…).

Every item has its own currency: things are bought in hryvnias, lei or euros, and a single "price" column summed them
as one (the problem with the Notion page this replaces). Totals are per currency; the page converts them to one at NBU
rates for an overall figure. The whole document is saved at once, as Collecting does."""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse
from app.versioning import BaseVersion, check_base_version

router = APIRouter(prefix="/life/purchases", tags=["purchases"])

Currency = Literal["UAH", "EUR", "USD", "RON", "PLN", "GBP"]
Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
Money = Annotated[float | None, Field(default=None, ge=0, le=1_000_000_000)]
_WEB_LINK = re.compile(r"^https?://[^\s\"'<>]+$", re.I)


def _link(v: str) -> str:
    """Only web links: the page turns this into a link, so a javascript: one must never get in."""
    v = (v or "").strip()
    if v and not _WEB_LINK.match(v):
        raise ValueError("a link must start with http:// or https://")
    return v


class Purchase(BaseModel):
    id: Id
    title: str = Field(min_length=1, max_length=300)
    category: str = Field(default="", max_length=100)  # brand or kind: "Logitech", "Marvel Premier Collection"
    bought: bool = False
    planned: Money = None  # the price you expected
    paid: Money = None  # what it cost; 0 is a gift or free
    currency: Currency = "UAH"
    url: str = Field(default="", max_length=2000)
    store: str = Field(default="", max_length=100)
    note: str = Field(default="", max_length=2000)

    @field_validator("url")
    @classmethod
    def _web_link(cls, v: str) -> str:
        return _link(v)

    # Before the length checks, so a title of only spaces counts as empty.
    @field_validator("title", "category", "store", mode="before")
    @classmethod
    def _trim(cls, v: object) -> object:
        return v.strip() if isinstance(v, str) else v


class PurchaseList(BaseModel):
    id: Id
    title: str = Field(min_length=1, max_length=100)
    currency: Currency = "UAH"  # for new items added to this list
    items: list[Purchase] = Field(default_factory=list, max_length=500)


class Purchases(BaseModel):
    lists: list[PurchaseList] = Field(default_factory=list, max_length=50)


class PurchasesResponse(Purchases):
    updated_at: str | None = None


@router.get("", response_model=PurchasesResponse)
def get_purchases(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute("SELECT data, updated_at FROM purchase_lists WHERE user_id = %s", (user.id,)).fetchone()
    if not row:
        return PurchasesResponse()
    return PurchasesResponse(**Purchases(**(row[0] if isinstance(row[0], dict) else {})).model_dump(), updated_at=str(row[1]))


@router.put("", response_model=PurchasesResponse)
def save_purchases(
    payload: Purchases,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
    base_version: BaseVersion = None,
):
    check_base_version(conn, "purchase_lists", user.id, base_version)
    row = conn.execute(
        """
        INSERT INTO purchase_lists(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(payload.model_dump())),
    ).fetchone()
    conn.commit()
    return PurchasesResponse(**payload.model_dump(), updated_at=str(row[0]) if row else None)
