from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings, SettingsConfigDict

import app.auth.router as auth_router_module
import app.investing.analysis as analysis_router_module
import app.cinema.router as cinema_router_module
from app.cinema.ai import router as cinema_ai_router
import app.library.router as library_router_module
from app.library.ai import router as library_ai_router
import app.library.wikidata as library_wikidata_module
from app.library.series import router as library_series_router
from app.categories.router import router as categories_router
import app.investing.router as investing_router_module
from app.investing.router import router as investing_router
from app.investing.chat import router as investing_chat_router
from app.investing.stock import router as stock_router
from app.investing.watchlist import router as watchlist_router
from app.investing.events import router as events_router
from app.tasks.router import router as tasks_router
from app.games.router import router as games_router
from app.jobs.router import router as jobs_router
from app.pages.router import router as pages_router
from app.db import create_pool, init_db
from app.llm.client import DEFAULT_FALLBACK_MODELS, DEFAULT_MODEL, LLMClient
import app.broker.router as broker_router_module


class Settings(BaseSettings):
    app_name: str = "Olivia API"
    app_version: str = "0.1.0"
    database_url: str = ""
    auth_token_secret: str = "dev-secret-change-me"
    auth_token_ttl_seconds: int = 60 * 60 * 24 * 7  # 7 days
    allow_registration: bool = False  # new accounts: closed unless turned on, e.g. to create the first one
    tmdb_api_key: str = ""  # Cinematography autofill; v3 API key or v4 read access token
    # Library series (Wikidata): a URL or email for the User-Agent, which raises Wikimedia's rate limit 20×
    wikidata_contact: str = "https://github.com/Lensom/stocks"
    google_books_api_key: str = ""  # Library: optional, better covers/details for Ukrainian editions
    gemini_api_key: str = ""  # Investing: AI stock analysis
    gemini_model: str = DEFAULT_MODEL  # tried first
    gemini_fallback_models: str = ",".join(DEFAULT_FALLBACK_MODELS)  # comma-separated, tried in order when the first fails
    # Investing: sync with Freedom24 (Tradernet API). Used only through the read-only client in app/broker/freedom24.py.
    freedom24_public_key: str = ""
    freedom24_private_key: str = ""
    # Only this account (its login email) can see the Freedom24 data; empty = nobody.
    freedom24_owner_email: str = ""
    cors_origins: str = (
        "http://localhost:3000,"
        "http://127.0.0.1:3000,"
        "http://localhost:3001,"
        "http://127.0.0.1:3001,"
        "http://192.168.100.150:3000,"
        "http://192.168.100.150:3001"
    )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()

app = FastAPI(title=settings.app_name, version=settings.app_version)

# Every route lives under /api: on Vercel the frontend and the API share one domain, and the
# "/api/(.*)" rewrite passes the full path through, so local dev uses the same prefix.
API_PREFIX = "/api"

if not settings.database_url:
    raise RuntimeError("DATABASE_URL is required (Neon Postgres connection string).")

pool = create_pool(settings.database_url)
init_db(pool)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["*"]
        if settings.cors_origins.strip() == "*"
        else [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    ),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_conn():
    # Returned object is used by auth deps (psycopg connection).
    with pool.connection() as conn:
        yield conn


def get_settings():
    return settings


app.dependency_overrides[auth_router_module.get_conn] = get_conn
app.dependency_overrides[auth_router_module.get_settings] = get_settings
app.include_router(auth_router_module.router, prefix=API_PREFIX)
app.include_router(categories_router, prefix=API_PREFIX)
app.include_router(investing_router, prefix=API_PREFIX)
app.include_router(watchlist_router, prefix=API_PREFIX)
app.include_router(stock_router, prefix=API_PREFIX)
app.include_router(events_router, prefix=API_PREFIX)
app.dependency_overrides[cinema_router_module.get_tmdb_key] = lambda: settings.tmdb_api_key.strip()
app.include_router(cinema_router_module.router, prefix=API_PREFIX)
app.dependency_overrides[broker_router_module.get_freedom24_settings] = lambda: broker_router_module.Freedom24Settings(
    public_key=settings.freedom24_public_key.strip(),
    private_key=settings.freedom24_private_key.strip(),
    owner_email=settings.freedom24_owner_email.strip(),
)
app.include_router(broker_router_module.router, prefix=API_PREFIX)
# Investing pages read positions, trades, deposits, dividends and cash from Freedom24 for the keys' owner.
app.dependency_overrides[investing_router_module.get_broker_source] = lambda: (
    lambda user: broker_router_module.source_for(user, app.dependency_overrides[broker_router_module.get_freedom24_settings]())
)
app.dependency_overrides[library_router_module.get_google_books_key] = lambda: settings.google_books_api_key.strip()
app.include_router(library_router_module.router, prefix=API_PREFIX)
library_wikidata_module.CONTACT = settings.wikidata_contact.strip()
app.include_router(library_series_router, prefix=API_PREFIX)
app.include_router(tasks_router, prefix=API_PREFIX)
app.include_router(games_router, prefix=API_PREFIX)
app.include_router(jobs_router, prefix=API_PREFIX)
_llm = (
    LLMClient(
        api_key=settings.gemini_api_key.strip(),
        models=[settings.gemini_model, *settings.gemini_fallback_models.split(",")],
    )
    if settings.gemini_api_key.strip()
    else None
)
app.dependency_overrides[analysis_router_module.get_llm] = lambda: _llm
app.include_router(analysis_router_module.router, prefix=API_PREFIX)
app.include_router(investing_chat_router, prefix=API_PREFIX)
app.include_router(cinema_ai_router, prefix=API_PREFIX)
app.include_router(library_ai_router, prefix=API_PREFIX)
app.include_router(pages_router, prefix=API_PREFIX)


@app.get(f"{API_PREFIX}/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}
