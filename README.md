# Olivia

A personal dashboard. Its most developed area is **Investing**: net worth across every account, a stock portfolio tracker (live quotes, rebalancing, funding, trades, performance vs the S&P 500) and a crypto workspace. Health, Habits and Finances sections are scaffolded.

- **Frontend:** Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, TypeScript (`front/`)
- **Backend:** FastAPI, Pydantic, psycopg 3 with a Postgres connection pool (`back/`)
- **Database:** Postgres (Neon). Tables are created automatically on startup.
- **Market data:** Yahoo Finance (prices, S&P 500 benchmark), Stooq (price fallback), Finviz (names, sectors, P/E, EPS, beta, dividend yield), CoinGecko (crypto), National Bank of Ukraine (official exchange rates), Frankfurter (historical FX for trades)

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

Open http://localhost:3000, register an account, and open **Investing** in the sidebar.

The frontend calls the API on port 8000 of the same host the page was opened from, so it also works from another device on your LAN. To point it somewhere else, set `NEXT_PUBLIC_API_BASE` (e.g. in `front/.env.local`).

## Configuration (`back/.env`)

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string, e.g. `postgresql://user:pass@host.neon.tech/db?sslmode=require`. The API refuses to start without it. |
| `AUTH_TOKEN_SECRET` | yes, in any shared setup | Secret used to sign login tokens. The default is for local development only. |
| `AUTH_TOKEN_TTL_SECONDS` | no | How long a login lasts. Default `604800` (7 days). |
| `CORS_ORIGINS` | no | Comma-separated allowed origins, or `*`. Defaults cover `localhost:3000/3001` and the LAN IP. |
| `APP_NAME`, `APP_VERSION` | no | Shown in `/health` and the API docs. |

## Features: Investing

The **Investing** page (`/investing`) shows every investing page as a tile with a live figure. **Reorder** lets you drag tiles (or use arrows) to change the order of the sidebar and the Stocks tabs; you can also add custom pages there. Page names and links are defined once in `front/src/features/investing/nav.ts`.

### Total (`/investing/total`)

Net worth in one number, replacing a monthly spreadsheet:

- **Accounts:** Stocks and Crypto are live from the app; bank accounts and cash are typed in any currency and converted at official NBU rates (a rate can be overridden). Debts owed to you add, debts you owe subtract.
- **Mix vs goal:** stocks / savings / crypto share against editable goals (default 70 / 20 / 10), with how much the furthest-behind group needs.
- **History:** **Record &lt;month&gt;** stores today's net worth with its breakdown. A monthly chart, month-over-month change and year-end totals; older months can be typed in.

### Stocks

| Tab | Route | What it does |
|---|---|---|
| **Overview** | `/investing/dashboard` | Portfolio value and today's change; total return against money actually deposited; realized P&L; dividend income and beta. Heatmap (size = weight, color = today's move), today's movers, winners and losers, allocation by holding and industry, concentration risk, rebalance-to-target suggestions, capital history. |
| **Portfolio** | `/investing/holdings` | Holdings table with View/Edit modes, sorting, search, filters (winners, losers, off target) and totals. Expand a row for cost basis, buy/trim to target and Yahoo/Finviz links. **Import XLSX** and **Autofill names & industry**. |
| **Finance** | `/investing/finance` | Deposits and all fees (refill + buy + sell commissions); net gain, annualized (XIRR) return, fees as % of deposits; current-year pace; yearly summary; deposits vs buys with an estimate of uninvested cash. |
| **Allocation rules** | `/investing/picking` | Buckets (ETF / REIT / Fund, Value / Blue chips) with their target share and position limit checked against the portfolio. Each stock gets a **Strong buy / May buy / Wait** signal from your buy zones, upside to price goals, and **Autofill fundamentals** (P/E, EPS, beta, yield). |
| **Activities** | `/investing/activities` | One trade log (newest first) with View/Edit modes, search, buy/sell and year filters, a summary of what's shown, a per-ticker breakdown and yearly totals. **Import XLSX** from a broker export. |
| **Analytics** | `/investing/analytics` | Yearly return vs the S&P 500 (SPY, dividends reinvested), value vs money invested, a year-by-year table, risk & income by holding (beta contribution, dividend income) and trading results by year. |
| **Notes** | `/investing/notes` | Investing rules with autosave, Write/Preview, and a panel of live numbers (ETF share, fees %, XIRR, largest position) to check the rules against. |

### Crypto (`/investing/crypto`)

| Tab | What it does |
|---|---|
| **Overview** | Value and today's change, total return on funding, money lost to fees/spread; per coin: average buy, P&L and price vs your average; BTC/ETH split vs your rule with where the next deposit should go. |
| **Portfolio** | Coins with View/Edit modes: price, day change, value, weight, average buy and P&L. |
| **Funding & buys** | UAH → USD funding (rate per row, spent vs received) and BTC/ETH purchases (coins bought per row, totals and average prices). |
| **Allocation rules** | BTC/ETH target split, with a fixed split and a "toward the rule" split for the next deposit. |

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

### Importing trades (Activities)

On **Activities**, click **Import XLSX** and choose a broker trade export with these columns:

| Trade# | Order# | Time | Ticker | Direction | Price | Quantity | Amount | Fee | Profit |
|---|---|---|---|---|---|---|---|---|---|
| 159553933 | 154766710 | 21.07.2021 20:31:12 | AMD.US | buy | 88.76 | 1 | 88.76 | €1.72 | $0 |

- **Currency exchanges** (`RUR/USD`, `EUR/USD`, any ticker with `/`) are skipped; they aren't stock trades.
- **No duplicates.** A trade is skipped if its Trade# was imported before, or if a hand-entered trade has the same direction, ticker, date and quantity with a price within 0.5%. Importing the same file twice adds nothing.
- **Currency:** `.US` tickers trade in USD; otherwise the currency of the Profit value is used (e.g. `₽0` means RUB). Fees and profits in another currency are converted to the trade's currency at that day's rate.
- **Names and categories** come from your existing trades for the same ticker first, then from Finviz.
- Rows that can't be read (bad date, unknown direction…) are listed by row number.
- As with holdings, nothing is saved until you press **Save**.

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
    features/investing/  # charts, dashboard widgets, nav (page names/links), stats helpers
    state/               # React context stores (auth, categories, investing, crypto)
    lib/api.ts           # fetch wrapper (base URL, auth header, JSON / FormData)
```

## API overview

All `/investing/*` and `/categories/*` endpoints need an `Authorization: Bearer <token>` header from `/auth/login`. Investing data is stored per user, mostly as one JSON document per section.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Categories | `GET/POST /categories`, `GET/POST /categories/{id}/subcategories`, `PUT …/reorder` |
| Imports | `POST /investing/holdings/import`, `POST /investing/activities/import` (parse a file and return rows; nothing is saved) |
| Market data | `GET /investing/quotes`, `/profiles`, `/fundamentals` (all `?tickers=`), `GET /investing/benchmark?symbol=SPY`, `GET /investing/rates`, `GET/PUT /investing/metrics` |
| Sections | `GET/PUT` on `/investing/holdings`, `/refills`, `/activities`, `/capital-entries`, `/picking`, `/notes`, `/crypto`, `/total` |

## Market data notes

- **Quotes** are fetched from Yahoo's v8 chart endpoint, all tickers at the same time. If Yahoo has no price, the app falls back to Stooq, then CoinGecko for crypto. Prices are cached briefly in memory.
- **Beta and dividend yield** are averages weighted by each holding's share of the portfolio, using Finviz data. A ticker with no data is left out of the average rather than counted as 0. A stock that pays no dividend counts as 0% yield.
- **Names, industries and fundamentals** come from Finviz: sector for stocks, `ETF · <category>` for funds, plus P/E, EPS, beta and yield. Lookups are cached (fundamentals 1 h, names 24 h; failures are retried after 5 min).
- **Benchmark:** S&P 500 yearly total returns come from Yahoo's monthly adjusted closes for SPY (cached 6 h); the current year is year-to-date.
- **Exchange rates:** the Total page uses official National Bank of Ukraine rates (cached 3 h). Trade imports convert fees/profits with Frankfurter rates for the trade date.
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
