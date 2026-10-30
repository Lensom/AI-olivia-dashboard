from __future__ import annotations

from psycopg_pool import ConnectionPool


def create_pool(database_url: str) -> ConnectionPool:
    # Neon uses Postgres; SSL is typically required and included in the URL.
    # Neon closes idle connections (compute suspends): check each one before handing it out and
    # retire idle ones early, so a request never gets a dead connection.
    return ConnectionPool(
        conninfo=database_url,
        min_size=1,
        max_size=10,
        open=True,
        timeout=5,
        check=ConnectionPool.check_connection,
        max_idle=240,
    )


def init_db(pool: ConnectionPool) -> None:
    with pool.connection() as conn:
        conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS categories (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(user_id, slug)
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS subcategories (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                category_id BIGINT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                slug TEXT NOT NULL,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                UNIQUE(category_id, slug)
            );
            """
        )
        conn.execute(
            "ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0"
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_metrics (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                div_yield_percent TEXT NOT NULL DEFAULT '—',
                beta TEXT NOT NULL DEFAULT '—',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_holdings (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                holdings JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_capital_entries (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                entries JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_notes (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                notes TEXT NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_activities (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                activities JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_picking (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                rows JSONB NOT NULL,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_refills (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                rows JSONB NOT NULL DEFAULT '[]'::jsonb,
                operating_expenses_usd TEXT NOT NULL DEFAULT '',
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_broker (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cinema_titles (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS library_items (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS life_pages (
                id TEXT PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                parent_id TEXT REFERENCES life_pages(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT '',
                icon TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT 'doc',
                content JSONB,
                sort_order INT NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS life_pages_user_parent ON life_pages(user_id, parent_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS game_lists (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS task_boards (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_total (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_crypto (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        # Latest Gemini analysis per ticker (app/investing/analysis.py).
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_ai_analyses (
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                ticker TEXT NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (user_id, ticker)
            );
            """
        )
        conn.commit()

