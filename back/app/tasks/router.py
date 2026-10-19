from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from psycopg import Connection
from psycopg.types.json import Json
from pydantic import BaseModel, Field

from app.auth.router import get_current_user, get_conn
from app.auth.schemas import UserResponse


router = APIRouter(prefix="/tasks", tags=["tasks"])

TaskStatus = Literal["todo", "hold", "in_progress", "completed"]


class Task(BaseModel):
    id: str
    title: str = Field(default="", max_length=500)
    status: TaskStatus = "todo"
    created_at: str = ""  # ISO timestamp
    completed_at: str = ""


class TaskBoard(BaseModel):
    # Order within a column is the order of this list.
    tasks: list[Task] = Field(default_factory=list)


class TaskBoardResponse(TaskBoard):
    updated_at: str | None = None


@router.get("", response_model=TaskBoardResponse)
def get_tasks(
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute("SELECT data, updated_at FROM task_boards WHERE user_id = %s", (user.id,)).fetchone()
    if not row:
        return TaskBoardResponse()
    return TaskBoardResponse(**TaskBoard(**(row[0] if isinstance(row[0], dict) else {})).model_dump(), updated_at=str(row[1]))


@router.put("", response_model=TaskBoardResponse)
def update_tasks(
    payload: TaskBoard,
    user: Annotated[UserResponse, Depends(get_current_user)],
    conn: Annotated[Connection, Depends(get_conn)],
):
    row = conn.execute(
        """
        INSERT INTO task_boards(user_id, data, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
        RETURNING updated_at
        """,
        (user.id, Json(payload.model_dump())),
    ).fetchone()
    conn.commit()
    return TaskBoardResponse(**payload.model_dump(), updated_at=str(row[0]) if row else None)
