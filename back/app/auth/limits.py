"""Limits on failed logins, so a password can't be guessed by trying many.

Counted per email and per client address, in the database because on Vercel every request may land on a new instance.
Only hashes of the email and address are stored. While a key is over its limit, login answers 429 without checking the
password, so blocked tries teach nothing. A success clears the email's count."""

from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta

from fastapi import Request
from psycopg import Connection

WINDOW = timedelta(minutes=15)
LIMITS = {"email": 5, "ip": 30}  # failed tries per window; an address can be shared, so it gets more


def key(kind: str, value: str) -> str:
    return f"{kind}:{hashlib.sha256(value.strip().lower().encode()).hexdigest()}"


def client_address(request: Request) -> str:
    """Vercel sets x-real-ip and x-forwarded-for itself, so a client can't choose them there.
    Elsewhere they could be forged, which only weakens the per-address limit: the per-email one still holds."""
    forwarded = request.headers.get("x-real-ip") or (request.headers.get("x-forwarded-for") or "").split(",")[0]
    return forwarded.strip() or (request.client.host if request.client else "unknown")


def wait_seconds(conn: Connection, keys: list[str], now: datetime) -> int:
    """How long until a login may be tried again; 0 when it may now."""
    rows = conn.execute("SELECT key, failures, window_start FROM login_failures WHERE key = ANY(%s)", (keys,)).fetchall()
    wait = 0.0
    for k, failures, start in rows:
        left = (start + WINDOW - now).total_seconds()
        if failures >= LIMITS[k.split(":", 1)[0]] and left > 0:
            wait = max(wait, left)
    return math.ceil(wait)


def record_failure(conn: Connection, keys: list[str], now: datetime) -> None:
    conn.execute("DELETE FROM login_failures WHERE window_start < %s", (now - WINDOW,))  # old windows: nothing to keep
    for k in keys:
        conn.execute(
            """
            INSERT INTO login_failures(key, failures, window_start) VALUES (%s, 1, %s)
            ON CONFLICT (key) DO UPDATE SET failures = login_failures.failures + 1
            """,
            (k, now),
        )
    conn.commit()


def clear(conn: Connection, k: str) -> None:
    conn.execute("DELETE FROM login_failures WHERE key = %s", (k,))
    conn.commit()
