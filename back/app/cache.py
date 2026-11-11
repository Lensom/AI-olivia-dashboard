"""A cache in Postgres for slow public answers from other services: book series from Wikidata, film collections from TMDB.

In-memory caches are lost when the server restarts, and on Vercel each instance starts with its own empty one, so the
first visit paid the full wait again (15-20 s for the Library's series). This layer sits behind them and is shared.
Only public data goes here, never anything of a user's. A failure here is never an error: the caller just fetches."""

from __future__ import annotations

import logging
import random
from datetime import datetime, timedelta, timezone
from typing import Any

from psycopg.types.json import Json
from psycopg_pool import ConnectionPool

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None
_PRUNE_AFTER = timedelta(days=60)


def use_pool(pool: ConnectionPool | None) -> None:
    """Set once at startup (main.py). Without a pool every lookup is a miss and every store a no-op."""
    global _pool
    _pool = pool


def get_many(keys: list[str], ttl: timedelta) -> dict[str, Any]:
    """The fresh values among these keys, in one query. A stored None comes back as None, so check `key in result`."""
    if not keys or _pool is None:
        return {}
    try:
        with _pool.connection() as conn:
            rows = conn.execute(
                "SELECT key, value FROM api_cache WHERE key = ANY(%s) AND stored_at > %s",
                (list(dict.fromkeys(keys)), datetime.now(timezone.utc) - ttl),
            ).fetchall()
    except Exception:
        logger.warning("api_cache read failed", exc_info=True)
        return {}
    return {key: value.get("v") for key, value in rows if isinstance(value, dict)}


def put_many(values: dict[str, Any]) -> None:
    if not values or _pool is None:
        return
    try:
        with _pool.connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(
                    """
                    INSERT INTO api_cache(key, value, stored_at) VALUES (%s, %s, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, stored_at = EXCLUDED.stored_at
                    """,
                    [(k, Json({"v": v})) for k, v in values.items()],
                )
            if random.random() < 0.02:  # now and then, drop what nobody has asked for in a long time
                conn.execute("DELETE FROM api_cache WHERE stored_at < %s", (datetime.now(timezone.utc) - _PRUNE_AFTER,))
            conn.commit()
    except Exception:
        logger.warning("api_cache write failed", exc_info=True)
