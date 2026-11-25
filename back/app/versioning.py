"""Saves that would overwrite a newer version answer 409 instead.

Most sections are one JSON document per account, and their PUT replaces it whole. Without a check, a save from a
tab (or phone) that loaded the document earlier silently erased what another tab saved since. The client sends the
`updated_at` it last saw as `X-Base-Version` (`apiFetch` does it on its own); the save goes through only if the row
still has that version. No header: saved as before, so older clients and scripts keep working.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import Header, HTTPException
from psycopg import Connection, sql

BaseVersion = Annotated[str | None, Header(alias="X-Base-Version", include_in_schema=False)]

# A code with the message, so the client can tell this 409 from the others (e.g. "trades come from Freedom24").
CONFLICT_DETAIL = {
    "code": "version_conflict",
    "message": "This was changed in another tab or on another device. Reload the page to get the latest version, then make your change again.",
}
# Sent by a client that saw no saved document yet.
NONE = "none"


def check_base_version(conn: Connection, table: str, user_id: int, base: str | None) -> None:
    """Locks the account's row until the save commits, then raises 409 if it changed since `base`."""
    if not base:
        return
    row = conn.execute(
        sql.SQL("SELECT updated_at FROM {} WHERE user_id = %s FOR UPDATE").format(sql.Identifier(table)),
        (user_id,),
    ).fetchone()
    current = row[0] if row else None
    if base == NONE:
        if current is not None:
            raise HTTPException(status_code=409, detail=CONFLICT_DETAIL)
        return
    try:
        seen = datetime.fromisoformat(base)
    except ValueError:
        return  # not a version this server gave out: don't block the save
    if current is None or seen.tzinfo is None:
        return
    if current != seen:
        raise HTTPException(status_code=409, detail=CONFLICT_DETAIL)
