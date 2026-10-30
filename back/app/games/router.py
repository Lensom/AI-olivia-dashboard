from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.auth.router import get_current_user, get_conn
from app.auth.schemas import UserResponse


router = APIRouter(prefix="/games", tags=["games"])


class Game(BaseModel):
    id: str
    title: str = Field(default="", max_length=300)
    year: int | None = Field(default=None, ge=1970, le=2100)  # year you finished it, when you remember
    added_at: str = ""  # ISO date


class GameList(BaseModel):
    games: list[Game] = Field(default_factory=list)


class GameListResponse(GameList):
    updated_at: str | None = None


@router.get("", response_model=GameListResponse)
def get_games(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute("SELECT data, updated_at FROM game_lists WHERE user_id = %s", (user.id,)).fetchone()
    if not row:
        return GameListResponse()
    return GameListResponse(**GameList(**(row[0] if isinstance(row[0], dict) else {})).model_dump(), updated_at=str(row[1]))


@router.put("", response_model=GameListResponse)
def update_games(
    payload: GameList,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute(
        """
        INSERT INTO game_lists(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(payload.model_dump())),
    ).fetchone()
    conn.commit()
    return GameListResponse(**payload.model_dump(), updated_at=str(row[0]) if row else None)
