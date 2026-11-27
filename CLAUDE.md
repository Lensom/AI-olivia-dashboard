# Olivia

A personal dashboard for one owner: Investing (portfolio, crypto, net worth, Freedom24 sync, Gemini analysis/chat),
Cinematography, Library and Life (tasks, games, career, jobs, collecting, places, improvements, purchases).
README.md is the user-facing reference for features, env vars and the API; read the relevant section before changing
a feature instead of guessing how it behaves.

- `back/`: FastAPI + Pydantic + psycopg 3 (pool) on Postgres (Neon). Python 3.14 (CI and `.venv`).
- `front/`: Next.js 16 App Router, React 19, Tailwind 4, TypeScript. See `front/CLAUDE.md`.
- Deploy: one Vercel project, two services (`vercel.json`). `/api/*` → back, everything else → front.
  Vercel Cron hits `/api/life/jobs/cron` daily.

## Commands

Windows machine; PowerShell is the primary shell. Use the venv's Python, not the global one.

| What | Command (from repo root) |
|---|---|
| Backend tests (all) | `cd back; .venv\Scripts\python -m unittest discover -s tests` |
| One test module | `cd back; .venv\Scripts\python -m unittest tests.test_purchases` |
| Run API | `cd back; .venv\Scripts\uvicorn app.main:app --reload` (http://localhost:8000/api/health, /docs) |
| Frontend checks | `cd front; npx tsc --noEmit; npm run lint` |
| Frontend build | `cd front; npm run build` |
| Run front | `cd front; npm run dev` (http://localhost:3000) |

CI (`.github/workflows/ci.yml`) runs exactly these: backend unittest against a real Postgres 16, then frontend
`tsc`, `lint`, `build`. Before saying a change is done, run the checks for the side you touched.

`uvicorn --reload` on Windows sometimes misses changes: a new endpoint answering 404 usually means "restart it".

## Hard rules

- **Freedom24 is read-only.** `back/app/broker/freedom24.py` allows only commands in `READ_ONLY_COMMANDS`, and
  `tests/test_freedom24_readonly.py` guards it. Never add a trading/money-moving command, never bypass `_call`.
- **Never commit secrets.** `back/.env` holds real keys (DB, Gemini, Freedom24, TMDB). Don't print its values either.
  New settings go into `Settings` in `back/app/main.py`, `back/.env.example` (commented) and README's config table.
- **`back/.cache/`** holds local backups of real portfolio data. Don't read it into answers, don't commit it.
- **Registration stays closed** (`ALLOW_REGISTRATION=false`). Don't add a sign-up form.
- **`api_cache` (`back/app/cache.py`) is for public data only**, never a user's own data.
- Every user-data query is scoped by `user_id` from `get_current_user`. No endpoint returns another account's data.

## How the app is built

- **One JSON document per user per section.** Most sections are a table `(user_id PK, data JSONB, updated_at)`,
  `GET` returns the doc plus `updated_at`, `PUT` replaces it whole. Tables are created in `init_db` (`back/app/db.py`)
  with `CREATE TABLE IF NOT EXISTS` on startup. There are no migrations, so schema changes must stay additive and the
  Pydantic model must accept old documents (defaults for new fields).
- **Optimistic concurrency.** Every document `PUT` calls `check_base_version(conn, table, user.id, base_version)`
  (`back/app/versioning.py`). `apiFetch` sends `X-Base-Version` automatically. A 409 `version_conflict` shows
  the reload banner. A new section gets this for free if it follows the pattern; don't skip it.
- **All routes are under `/api`** (`API_PREFIX` in `main.py`), locally too.
- **Sidebar menus come from the backend.** Default subcategories live in `_DEFAULTS` in `back/app/categories/router.py`
  and must match the frontend `nav.ts` of that section. `tests/test_subcategory_defaults.py` pins the order.
- **LLM calls** go through `back/app/llm/client.py` (Gemini, retries, structured output, model fallback chain).
  Don't call `google.genai` directly. AI chat answers are checked by `investing/chat_check.py`.
- **Market data** comes from unofficial sources (Yahoo, Stooq, Finviz, CoinGecko, NBU, Frankfurter). A failure must
  degrade to `—`, never break the page. Pages show saved data first and apply live prices when they arrive.

Adding a whole new section (Life page, etc.): use the `/new-life-section` skill, which has the full wiring checklist.

## Writing style (code, comments, UI, docs)

The codebase has a consistent voice. Match it:

- Comments and docstrings explain **why** and what the user sees, in plain full sentences. Each router starts with a
  module docstring saying what the section is and any non-obvious decision (see `purchases/router.py`).
- No filler comments that restate the code.
- UI text is short, plain English. It's the i18n key (see `front/CLAUDE.md`), and every new string needs a Ukrainian
  translation.
- When behaviour visible to the user changes, update the matching README section in the same change.

## Git

- Commit messages: `feat: …` / `fix: …`, lowercase, short, several changes joined with commas
  (`feat: add purchases table, add total spent table`).
- Work happens on `master`. Commit or push only when asked.
- `front/AGENTS.md` is rewritten by `next dev`. If it shows up changed, commit it as is rather than reverting.
