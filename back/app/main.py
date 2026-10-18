from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings, SettingsConfigDict

import app.auth.router as auth_router_module
import app.cinema.router as cinema_router_module
import app.library.router as library_router_module
from app.categories.router import router as categories_router
from app.investing.router import router as investing_router
from app.db import create_pool, init_db


class Settings(BaseSettings):
    app_name: str = "Olivia API"
    app_version: str = "0.1.0"
    database_url: str = ""
    auth_token_secret: str = "dev-secret-change-me"
    auth_token_ttl_seconds: int = 60 * 60 * 24 * 7  # 7 days
    tmdb_api_key: str = ""  # Cinematography autofill; v3 API key or v4 read access token
    google_books_api_key: str = ""  # Library: optional, better covers/details for Ukrainian editions
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
app.include_router(auth_router_module.router)
app.include_router(categories_router)
app.include_router(investing_router)
app.dependency_overrides[cinema_router_module.get_tmdb_key] = lambda: settings.tmdb_api_key.strip()
app.include_router(cinema_router_module.router)
app.dependency_overrides[library_router_module.get_google_books_key] = lambda: settings.google_books_api_key.strip()
app.include_router(library_router_module.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name}
