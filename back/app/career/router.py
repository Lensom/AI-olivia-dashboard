"""Life → Career: the job search before moving to the Netherlands, as one document per user.

- progress: the learning roadmap (front/src/features/life/career/roadmap.ts), item id → 1 in progress / 2 done
- checks: ticked items of the weekly plan and the checklists (front/src/features/life/career/plan.ts, guide.ts)
- weeks: this week's counts the plan asks for (messages, mock interviews, posts, the Friday funnel), by the week's Monday
- applications: where you applied and how far each got, for the funnel
- notes: your own lines for the STAR stories

Each page saves only its part: a PUT changes the fields it sends and keeps the rest."""

from __future__ import annotations

import re
import threading
import time
from datetime import date as Date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.auth.router import get_conn, get_current_user
from app.auth.schemas import UserResponse
from app.jobs.sponsors import company_key, fetch_registers

router = APIRouter(prefix="/life/career", tags=["career"])

ItemId = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{0,39}$")]
WeekKey = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]  # the week's Monday
Stage = Literal["applied", "recruiter", "technical", "final", "offer"]
_WEB = re.compile(r"^https?://[^\s\"'<>]+$", re.I)


class WeekCounts(BaseModel):
    messages: int = Field(default=0, ge=0, le=999)
    mock: int = Field(default=0, ge=0, le=99)
    post: int = Field(default=0, ge=0, le=99)
    funnel: bool = False


class Application(BaseModel):
    id: Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_-]{1,40}$")]
    company: str = Field(min_length=1, max_length=200)
    role: str = Field(default="", max_length=200)
    url: str = Field(default="", max_length=2000)
    wave: Literal["", "A", "B", "C"] = ""
    applied: WeekKey  # ISO day
    channel: Literal["referral", "recruiter", "direct", "cold"] = "direct"
    stage: Stage = "applied"  # the furthest it got
    closed: Literal["", "rejected", "withdrawn"] = ""  # still open while empty, unless it's an offer
    salary: str = Field(default="", max_length=100)
    sponsorship: Literal["unknown", "yes", "no"] = "unknown"
    notes: str = Field(default="", max_length=2000)
    job_id: str = Field(default="", max_length=40)  # the vacancy on the Jobs page it came from, if any

    @field_validator("url")
    @classmethod
    def _web_link(cls, v: str) -> str:
        v = v.strip()
        if v and not _WEB.match(v):
            raise ValueError("a link must start with http:// or https://")
        return v


class CareerData(BaseModel):
    progress: dict[ItemId, Literal[1, 2]] = Field(default_factory=dict, max_length=500)
    checks: dict[ItemId, Literal[True]] = Field(default_factory=dict, max_length=1000)
    weeks: dict[WeekKey, WeekCounts] = Field(default_factory=dict, max_length=200)
    applications: list[Application] = Field(default_factory=list, max_length=1000)
    notes: dict[ItemId, Annotated[str, StringConstraints(max_length=4000)]] = Field(default_factory=dict, max_length=100)


class CareerResponse(CareerData):
    updated_at: str | None = None


def _load(conn: Connection, user_id: int) -> tuple[dict[str, Any], Any]:
    row = conn.execute("SELECT data, updated_at FROM career_progress WHERE user_id = %s", (user_id,)).fetchone()
    return (row[0] if row and isinstance(row[0], dict) else {}), (row[1] if row else None)


def _store(conn: Connection, user_id: int, data: dict[str, Any]) -> CareerResponse:
    row = conn.execute(
        """
        INSERT INTO career_progress(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user_id, Json(data)),
    ).fetchone()
    conn.commit()
    return CareerResponse(**data, updated_at=str(row[0]) if row else None)


@router.get("", response_model=CareerResponse)
def get_career(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    data, updated = _load(conn, user.id)
    return CareerResponse(**CareerData(**data).model_dump(), updated_at=str(updated) if updated else None)


@router.put("", response_model=CareerResponse)
def save_career(
    payload: CareerData,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """Saves the parts sent; the others stay as they are (each page sends only its own)."""
    saved, _ = _load(conn, user.id)
    data = CareerData(**saved).model_dump()
    sent = payload.model_dump()
    for field in payload.model_fields_set:
        data[field] = sent[field]
    return _store(conn, user.id, data)


@router.post("/applications", response_model=CareerResponse)
def add_application(
    payload: Application,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    """Adds one application, e.g. from the Jobs page. The same vacancy (or link) twice is kept once."""
    saved, _ = _load(conn, user.id)
    data = CareerData(**saved).model_dump()
    same = lambda a: (payload.job_id and a.get("job_id") == payload.job_id) or (payload.url and a.get("url") == payload.url)  # noqa: E731
    if not any(same(a) for a in data["applications"]):
        if len(data["applications"]) >= 1000:
            raise HTTPException(status_code=422, detail="Too many applications")
        data["applications"] = [payload.model_dump(), *data["applications"]]
    return _store(conn, user.id, data)


# ---- Is a company a recognised sponsor? The registers the Jobs page uses, kept for a day here. ----

_registers: tuple[float, dict[str, dict[str, str]]] | None = None
_registers_lock = threading.Lock()
_REGISTERS_TTL = 24 * 60 * 60


def _current_registers() -> dict[str, dict[str, str]]:
    global _registers
    with _registers_lock:
        if _registers is None or time.time() - _registers[0] > _REGISTERS_TTL:
            found, _ = fetch_registers()
            if found:  # a failed download doesn't replace a good copy
                _registers = (time.time(), found)
        return _registers[1] if _registers else {}


class SponsorCheck(BaseModel):
    company: str
    ind: str = ""  # the name in the IND register (the Netherlands), when listed
    siri: str = ""  # the name in SIRI's fast-track list (Denmark), when listed


@router.post("/sponsors", response_model=list[SponsorCheck])
def check_sponsors(
    names: Annotated[list[Annotated[str, StringConstraints(max_length=200)]], Field(max_length=200)],
    user: Annotated[UserResponse, Depends(get_current_user)],
):
    """Which of these companies are on the official sponsor registers. Not listed doesn't mean they can't sponsor:
    the legal entity can have another name."""
    registers = _current_registers()
    return [
        SponsorCheck(company=n, ind=registers.get("NL", {}).get(company_key(n), ""), siri=registers.get("DK", {}).get(company_key(n), ""))
        for n in dict.fromkeys(n.strip() for n in names if n.strip())
    ]


def week_of(day: str) -> str:
    """The Monday of the week a day is in."""
    d = Date.fromisoformat(day)
    return Date.fromordinal(d.toordinal() - d.weekday()).isoformat()
