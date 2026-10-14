# Olivia

A personal dashboard. Its most developed area is **Investing**: a stock portfolio tracker with live quotes, allocation and rebalancing, funding history, trade activity, and a separate crypto workspace. Health, Habits and Finances sections are scaffolded.

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, TypeScript (`front/`)
- **Backend:** FastAPI, Pydantic, psycopg 3 with a Postgres connection pool (`back/`)
- **Database:** Postgres (Neon). Tables are created automatically on startup.
- **Market data:** Yahoo Finance (prices, day change), Stooq (price fallback), Finviz (beta, dividend yield, names and sectors), CoinGecko (crypto)

## Quick start

You need Python 3.11+, Node.js 20+, and a Postgres database (a free [Neon](https://neon.tech) project works).

### 1. Backend: http://localhost:8000

```powershell
cd back
python -m venv .venv
.venv\Scripts\Activate.ps1          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env              # macOS/Linux: cp .env.example .env
# edit .env: set DATABASE_URL and AUTH_TOKEN_SECRET
uvicorn app.main:app --reload
```

To check that it's running, open http://localhost:8000/health. Interactive API docs are at http://localhost:8000/docs.

### 2. Frontend: http://localhost:3000

```powershell
cd front
npm install
npm run dev
```

Open http://localhost:3000, register an account, and go to **Investing → Stocks**.

The frontend calls the API on port 8000 of the same host the page was opened from, so it also works from another device on your LAN. To point it somewhere else, set `NEXT_PUBLIC_API_BASE` (e.g. in `front/.env.local`).

## Configuration (`back/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgresql://user:pass@host.neon.tech/db?sslmode=require`. The API refuses to start without it. |
| `AUTH_TOKEN_SECRET` | yes, in any shared setup | Secret used to sign login tokens. The default is for local development only. |
| `AUTH_TOKEN_TTL_SECONDS` | no | How long a login lasts. Default `604800` (7 days). |
| `CORS_ORIGINS` | no | Comma-separated allowed origins, or `*`. Defaults cover `localhost:3000/3001` and the LAN IP. |
| `APP_NAME`, `APP_VERSION` | no | Shown in `/health` and the API docs. |

## Features: Investing → Stocks

| Tab | Route | What it does |
|---|---|---|
| **Overview** | `/investing/dashboard` | Portfolio value and today's change; total return measured against money actually deposited; realized P&L; dividend income estimate and beta. Also a heatmap (size = weight, color = today's move), today's movers, winners and losers, allocation by holding and by industry, concentration risk, rebalance-to-target suggestions, and capital history. |
| **Portfolio** | `/investing/holdings` | The holdings table: View and Edit modes, sorting, search, filters (winners, losers, off target), and a totals row. Click a row to expand it: cost basis, buy/trim to target, and Yahoo/Finviz links. Also **Import XLSX** and **Autofill names & industry**. |
| **Finance** | `/investing/finance` | Refills (deposits) and commissions; total and annualized (XIRR) return; current-year pace; yearly summary; deposits vs buys reconciliation, with an estimate of uninvested cash. |
| **Allocation rules** | `/investing/picking` | Research buckets with buy zones and price goals, enriched with live prices. |
| **Activities** | `/investing/activities` | Buy/sell log with currency conversion to USD and yearly totals. |
| **Analytics** | `/investing/analytics` | Charts of value over time and yearly activity volume. |
| **Notes** | `/investing/notes` | Free-form investing notes. |

Crypto has its own workspace at `/investing/crypto`: holdings, ledger, and rules.

### Importing holdings from a spreadsheet

On **Portfolio**, click **Import XLSX** and choose a `.xlsx` or `.csv` file. The header row needs these columns (case-insensitive):

| Ticker | Qty | Entry Price | Price | Value |
|---|---|---|---|---|
| AAPL.US | 3 | 162.462 | 342.84 | 1028.52 |

- Other columns (e.g. `Share (%)`, `Profit`, `Growth`) are ignored, because the app calculates them itself.
- A `.US` suffix is removed (`AAPL.US` becomes `AAPL`). Other exchange suffixes are kept.
- Tickers you already hold get new shares and prices. Name, target and industry are kept.
- New tickers are added as new rows.
- Holdings that aren't in the file are **kept** and listed so you can delete them yourself.
- Nothing is saved until you press **Save**. Imports, autofill and manual edits all stay unsaved until then. An amber banner and a warning when closing the tab protect unsaved changes.
- The old binary `.xls` format isn't supported; save the file as `.xlsx` first.

## Project structure

```
back/
  app/
    main.py              # FastAPI app, settings, CORS, DB pool
    db.py                # connection pool + CREATE TABLE IF NOT EXISTS schema
    auth/                # register / login / me, token signing
    categories/          # sidebar categories and subcategories
    investing/
      router.py          # all /investing endpoints + market data fetchers
      schemas.py         # request/response models
    seed_picking.py      # optional seed scripts (see below)
    seed_refills.py
  requirements.txt
front/
  src/
    app/                 # Next.js routes (investing/*, login, c/[slug], …)
    features/investing/  # charts, dashboard widgets, formatting and stats helpers
    state/               # React context stores (auth, categories, investing, crypto)
    lib/api.ts           # fetch wrapper (base URL, auth header, JSON / FormData)
```

## API overview

All `/investing/*` and `/categories/*` endpoints need an `Authorization: Bearer <token>` header from `/auth/login`. Investing data is stored per user, mostly as one JSON document per section.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Categories | `GET/POST /categories`, `GET/POST /categories/{id}/subcategories`, `PUT …/reorder` |
| Holdings | `GET/PUT /investing/holdings`, `POST /investing/holdings/import` (parses a file and returns the rows; doesn't save them) |
| Market data | `GET /investing/quotes?tickers=`, `GET /investing/profiles?tickers=`, `GET/PUT /investing/metrics` |
| Other sections | `GET/PUT` on `/investing/refills`, `/activities`, `/capital-entries`, `/picking`, `/notes`, `/crypto` |

## Market data notes

- **Quotes** are fetched from Yahoo's v8 chart endpoint, all tickers at the same time. If Yahoo has no price, the app falls back to Stooq, then CoinGecko for crypto. Prices are cached briefly in memory.
- **Beta and dividend yield** are averages weighted by each holding's share of the portfolio, using Finviz data. A ticker with no data is left out of the average rather than counted as 0. A stock that pays no dividend counts as 0% yield.
- **Names and industries** (autofill) come from Finviz: sector for stocks, `ETF · <category>` for funds.
- **The portfolio page doesn't wait for quotes.** Saved holdings show immediately and live prices are applied when they arrive, so a slow or unavailable data provider never hides your portfolio.
- These are unofficial public sources. If a provider changes its page or API, the related numbers show `—` until the parser is updated in `back/app/investing/router.py`.

## Seeding sample data (optional)

From `back/`, with the virtual environment activated:

```powershell
python -m app.seed_picking you@example.com          # allocation-rule buckets
python -m app.seed_refills you@example.com          # refill history
# add --force to replace data that already exists
```

## Development notes

- **Lint and type checks:** `npm run lint` and `npx tsc --noEmit` from `front/`.
- **Next.js version:** this project uses Next.js 16, which differs from older versions. See `front/AGENTS.md` and the bundled docs in `front/node_modules/next/dist/docs/`.
- **Auto-reload on Windows:** `uvicorn --reload` sometimes misses file changes. If a new endpoint returns 404, restart the server.
- **SQLite file:** `back/data/olivia.sqlite3` is left over from an earlier version. The app uses Postgres only.
