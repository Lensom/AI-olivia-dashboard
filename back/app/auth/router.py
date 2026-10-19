from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from psycopg import Connection

from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.auth.security import create_token, hash_password, verify_password, verify_token


router = APIRouter(prefix="/auth", tags=["auth"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")  # routes are mounted under /api in main.py


def get_conn() -> Connection:
    raise RuntimeError("DB dependency not wired")


def get_settings():
    raise RuntimeError("Settings dependency not wired")


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, conn: Annotated[Connection, Depends(get_conn)]):
    email = payload.email.lower().strip()
    pwd_hash = hash_password(payload.password)
    try:
        row = conn.execute(
            "INSERT INTO users(email, password_hash) VALUES(%s, %s) RETURNING id",
            (email, pwd_hash),
        ).fetchone()
        user_id = int(row[0])
        # Seed default categories for new user.
        conn.execute(
            """
            INSERT INTO categories(user_id, name, slug)
            VALUES
              (%s, %s, %s),
              (%s, %s, %s),
              (%s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (
                user_id,
                "Investing",
                "investing",
                user_id,
                "Habits",
                "habits",
                user_id,
                "Finances",
                "finances",
            ),
        )
        conn.commit()
    except Exception:
        raise HTTPException(status_code=409, detail="Email already registered")
    return UserResponse(id=user_id, email=email)


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    conn: Annotated[Connection, Depends(get_conn)],
    settings=Depends(get_settings),
):
    email = payload.email.lower().strip()
    row = conn.execute(
        "SELECT id, email, password_hash FROM users WHERE email = %s",
        (email,),
    ).fetchone()
    if not row or not verify_password(payload.password, row[2]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_token(
        secret=settings.auth_token_secret,
        sub=str(row[0]),
        ttl_seconds=settings.auth_token_ttl_seconds,
    )
    return TokenResponse(access_token=token)


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    conn: Annotated[Connection, Depends(get_conn)],
    settings=Depends(get_settings),
) -> UserResponse:
    payload = verify_token(secret=settings.auth_token_secret, token=token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    row = conn.execute("SELECT id, email FROM users WHERE id = %s", (int(payload.sub),)).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")

    return UserResponse(id=int(row[0]), email=row[1])


@router.get("/me", response_model=UserResponse)
def me(user: Annotated[UserResponse, Depends(get_current_user)]):
    return user

