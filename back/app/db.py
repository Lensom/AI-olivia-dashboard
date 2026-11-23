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
        # A connection whose network quietly died (the laptop slept, Wi-Fi changed, Neon suspended) would otherwise
        # hang a request until the page gives up after a minute: fail it in seconds so the next try gets a fresh one.
        # tcp_user_timeout works on Linux (Vercel); Windows ignores it and relies on keepalives.
        kwargs={
            "connect_timeout": 10,
            "keepalives": 1,
            "keepalives_idle": 10,
            "keepalives_interval": 3,
            "keepalives_count": 3,
            "tcp_user_timeout": 15000,
        },
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
        # Slow public answers of other services (app/cache.py), shared by every server instance. Nobody's own data.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_cache (
                key TEXT PRIMARY KEY,
                value JSONB NOT NULL,
                stored_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        # Failed logins per hashed email or address, for the limits in app/auth/limits.py.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS login_failures (
                key TEXT PRIMARY KEY,
                failures INT NOT NULL,
                window_start TIMESTAMPTZ NOT NULL
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
        # Fees paid outside the broker (deposit services, card currency exchange) that the broker never sees,
        # added to the broker's own fees in operating expenses.
        conn.execute("ALTER TABLE investing_refills ADD COLUMN IF NOT EXISTS external_fees_usd TEXT NOT NULL DEFAULT ''")
        # The same fees one by one (date, amount, note); external_fees_usd is kept as their sum.
        conn.execute("ALTER TABLE investing_refills ADD COLUMN IF NOT EXISTS external_fees JSONB NOT NULL DEFAULT '[]'::jsonb")
        # Hand-kept investing data saved before switching a section to the broker's API (Freedom24),
        # one row per table snapshot, so nothing typed by hand is ever lost.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS investing_manual_archive (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                kind TEXT NOT NULL,
                data JSONB NOT NULL,
                source_updated_at TIMESTAMPTZ,
                archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
        # Life → Career (app/career/router.py): progress through the roadmap, item id → in progress / done.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS career_progress (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        # Life → Collecting (app/collection/router.py): categories, lines with a status, and what to buy, as one document.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS collection_lists (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        # Life → Must visit (app/places/router.py): places and events, been there or planned, as one document.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS places_lists (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                data JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            );
            """
        )
        # Life → Jobs (app/jobs/router.py): your CV's text and last refresh; the vacancies found, with your status.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS job_search_profiles (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                cv_text TEXT,
                cv_name TEXT,
                cv_updated_at TIMESTAMPTZ,
                last_refresh_at TIMESTAMPTZ,
                sources JSONB NOT NULL DEFAULT '[]'::jsonb
            );
            """
        )
        # When you last looked at the vacancies (what's "new"), and the language your assessments are written in,
        # so the daily run (GET /life/jobs/cron) writes them the same way.
        conn.execute("ALTER TABLE job_search_profiles ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ")
        conn.execute("ALTER TABLE job_search_profiles ADD COLUMN IF NOT EXISTS lang TEXT")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS job_search_jobs (
                user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                id TEXT NOT NULL,
                data JSONB NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                assessed_at TIMESTAMPTZ,
                PRIMARY KEY (user_id, id)
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

