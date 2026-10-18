# Olivia

A personal dashboard. Its most developed area is **Investing**: net worth across every account, a stock portfolio tracker (live quotes, rebalancing, funding, trades, performance vs the S&P 500), a crypto workspace, **Cinematography** (your ratings of films, series, cartoons, anime and TV shows, with TMDB details, IMDb ratings and tops) and **Library** (books, comics, manga and magazines).

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
| `GOOGLE_BOOKS_API_KEY` | no | Library: adds Google Books to search and matching, which lists Ukrainian editions far better than Open Library. Free in Google Cloud console → APIs → Books API. Without it, Library uses Open Library plus Wikidata. |
| `TMDB_API_KEY` | no | Enables Cinematography search, posters and auto-filled genres / actors / studios. Free at themoviedb.org → Settings → API; a v3 API key or a v4 read access token both work. Without it, titles are added by hand. |

## Features: Investing

The **Investing** page (`/investing`) starts with **Needs attention**: rules you've broken (fees over your limit, return under your minimum, ETF share out of range, a position over its cap, holdings or net-worth groups drifting from target), opportunities (a stock in its buy zone, idle broker cash) and to-dos (record this month on Total, enter broker cash, record dividends). Each item links to the page that fixes it; the limits are editable under **Thresholds**. Below it, every investing page is a tile with a live figure. **Reorder** lets you drag tiles (or use arrows) to change the order of the sidebar and the Stocks tabs; you can also add custom pages there. Page names and links are defined once in `front/src/features/investing/nav.ts`.

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
| **Finance** | `/investing/finance` | Deposits and all fees (refill + buy + sell commissions); net gain, annualized (XIRR) return, fees as % of deposits; current-year pace; **broker cash** (any currency, counted in current value, returns and XIRR) and a **dividends log** (gross, tax withheld, net USD at the payment date's rate; last 12 months vs the yield estimate); yearly summary; deposits vs buys. |
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

## Features: Cinematography

Your ratings of films, series, cartoons, animated series, anime and TV shows, replacing the Notion table. The category is called **Cinematography**: create it on Home, and its pages appear automatically.

- **Overview** (`/cinematography`): totals, average score, recommendations (highest score first), what you're watching now, titles watched per year, your score distribution, top genres and the actors you watch most.
- **Films / Series / Cartoons / Animated series / Anime / TV shows** (`/cinematography/films`, `/series`, `/cartoons`, `/animated-series`, `/anime`, `/tv-shows`): a table (✓ recommended, Title, Genre, Status, Score, Year, Watched, Studio / distributor, Actors) or a poster grid. Every page except Films and Cartoons also has **Seasons** (watched up to season N out of those released, e.g. `4 / 5 +1 new`) and a **New seasons** filter. TV shows are reality, talk and game shows; Anime search puts Japanese animation first. You can search, filter by status, genre or recommended, and sort by score, year watched, release year, title or recently added.
- **Tops** (`/cinematography/tops`): your own ranked lists (like the Notion page: Топ фільмів, Серії фільмів, Кращі злодеї…), with numbered slots that are either a title from your library (poster, your score, IMDb) or free text (a franchise, a character), plus a note. Edit to rename, add from a library search, drag or ↑↓ to reorder, or change the number of slots. **Recreate my Notion tops** fills them in from the old page. Below them, **Built from your ratings** has automatic tops by genre, actor, director, studio, decade or kind, and any of them can be copied into your lists.
- **Add**: search TMDB and pick a result. Poster, genres, actors, studios, director, runtime / seasons, description and TMDB rating are filled in, and you add your score, status, year watched and the ✓. You can also add a title by hand.
- **Import CSV / XLSX**: in Notion use ••• → Export → Markdown & CSV and upload the `.csv`. Recognised columns, in English or Ukrainian: Title / Назва, Genre / Жанр, Status / Статус (Переглянуто → Watched, and so on), Score / Оцінка, Year / Рік, View Year, Studio / Distributor, Actors / Актори, Season / Сезон (Notion's `1 - 6` means watched up to season 6), Notes, Type, and the checkbox column (even unnamed). Titles already in the list are skipped, and a preview shows what will be added.
- **Fill from TMDB**: matches imported titles by name and year, and adds posters plus missing genres, actors and studios. Your score, status, ✓ and notes are never touched. Optionally it replaces your genres, actors and studios with TMDB's.
- **IMDb rating**: the global IMDb rating and vote count for each title, in its own column and as a sort option. On Overview it's compared with your average. The IMDb ID comes from TMDB, and the rating from IMDb's free daily dataset (`title.ratings.tsv.gz`), cached in `back/.cache/` and refreshed once a day. Ratings update in the background when the list opens, so a title needs a TMDB link first (Add from search or Fill from TMDB). A wrong link can be fixed with **Wrong title? Re-match** in the edit window.
- **Language**: TMDB data (titles, genres, descriptions) is in Ukrainian (`uk-UA`), with an English description when no Ukrainian one exists. Actor names come as TMDB stores them.
- **Saving**: every change (add, edit, ✓, delete, import) saves immediately.

## Features: Library

Books, comics, manga and magazines, replacing the Notion reading table. The category is called **Library** (slug `library`), and its pages appear automatically.

- **Overview** (`/library`): totals, average stars, read this year vs last year, pages read, what you're reading now, recommendations, recently finished, books finished per year, star distribution, top genres and the authors you read most.
- **Books / Comics / Manga / Magazines** (`/library/books`, `/comics`, `/manga`, `/magazines`): a table (✓, Title, Genre, Status, Score ★1–5, Author, Finished, Pages or Volumes, Readers' rating) or a cover grid. Filters: status, genre, recommended, year finished; sorts: score, date finished, title, author, published, pages, recently added. Comics and Manga track **volumes read / out**.
- **Add**: search by title or author, pick a result, and the cover, author, pages, year, publisher, description and readers' rating fill in. You can also add by hand.
- **Import CSV / XLSX** (Notion: ••• → Export → Markdown & CSV): recognises Title, Genre (`Jenre`) / Жанр, Status (Прочитано → Read, and so on), Score (`⭐⭐⭐⭐`, 1–5 or a 10-point score), Author / Автор, Finish date (`March 2, 2025`, ISO, `02.03.2025`), Pages, Volumes, Notes, Type and the checkbox column.
- **Fill covers & details**: matches by title and author on Open Library (plus Google Books with a key). Ukrainian titles are translated through Wikidata first ("Зелена миля" → *The Green Mile*). Your score, status, date, ✓ and notes are never changed. A title with no match can be found from its edit window with the English title; a wrong match can be fixed with **Wrong book? Re-match**.
- **Tops** (`/library/tops`): the same board as Cinematography's (your ranked lists plus automatic tops by genre, author, year read, decade published or kind).

## Project structure

```
back/
  app/
    main.py              # FastAPI app, settings, CORS, DB pool
    db.py                # connection pool + CREATE TABLE IF NOT EXISTS schema
    auth/                # register / login / me, token signing
    categories/          # sidebar categories and subcategories
    cinema/              # /cinema endpoints: titles, TMDB search/details/match, Notion import
    library/             # /library endpoints: books, Open Library / Google Books / Wikidata lookup, Notion import
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
    features/cinema/     # Cinematography nav, types, dialogs, tags/poster UI
    features/library/    # Library nav, types, dialogs, stars UI
    features/shared/     # Tops board and bar charts shared by Cinematography and Library
    state/               # React context stores (auth, categories, investing, crypto, broker, cinema, library)
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
| Cinematography | `GET/PUT /cinema`, `GET /cinema/search?q=&kind=`, `GET /cinema/details?media=&tmdb_id=`, `GET /cinema/match?title=&year=&kind=`, `POST /cinema/match-many`, `POST /cinema/imdb-ratings`, `POST /cinema/import` |
| Library | `GET/PUT /library`, `GET /library/search?q=&kind=`, `GET /library/details?source=&source_id=`, `POST /library/match-many`, `POST /library/import` |
| Sections | `GET/PUT` on `/investing/holdings`, `/refills`, `/activities`, `/capital-entries`, `/picking`, `/notes`, `/crypto`, `/total`, `/broker` (cash, dividends, attention thresholds) |

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
