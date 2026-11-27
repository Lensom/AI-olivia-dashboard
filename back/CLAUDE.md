# Backend (FastAPI)

## Module layout

One package per section in `app/<section>/`, usually just `router.py` (models + endpoints together), sometimes
`schemas.py`, `ai.py` (Gemini features), `sources.py` (external fetchers). Routers are registered in `app/main.py`.

Dependencies from `app.auth.router`: `get_conn` (pooled psycopg connection), `get_current_user` (`UserResponse`).
Settings/API keys reach routers through `app.dependency_overrides[...]` in `main.py`, not by importing `settings`.
Keep that, because it lets tests import routers without a database.

## Section document pattern

```python
router = APIRouter(prefix="/life/<slug>", tags=["<slug>"])

@router.get("", response_model=XResponse)        # SELECT data, updated_at ... WHERE user_id = %s
@router.put("", response_model=XResponse)        # check_base_version(...) → INSERT ... ON CONFLICT DO UPDATE ... RETURNING updated_at
```

Copy `app/purchases/router.py`: it's the cleanest, most recent example. Return `updated_at=str(row[...])`.

## Validation is the security boundary

Pydantic models put limits on everything: `max_length` on strings and lists, `ge`/`le` on numbers, `Literal` for enums,
an id pattern like `^[A-Za-z0-9_-]{1,40}$`. Trim strings in a `mode="before"` validator so whitespace-only fails
`min_length`. A URL the frontend renders as a link must pass an `http(s)://` check (no `javascript:`).
New fields always get defaults, because old stored documents must still load.

## SQL

- psycopg 3 with `%s` parameters. Dynamic identifiers only through `psycopg.sql.Identifier`, never f-strings.
- Call `conn.commit()` after writes.
- Schema lives in `app/db.py::init_db`, one `CREATE TABLE IF NOT EXISTS` per table with a comment naming the router
  that owns it. Add only, never drop or rename (no migration tool; prod runs this on every cold start).

## External services

- Use timeouts on every outbound request. A failure is logged and degrades to "no data", never a 500 for the page.
- Slow *public* lookups can go into `app/cache.py` (`get_many` / `put_many` with a TTL), behind any in-memory cache.
- Requests slower than 3 s are logged as `olivia.slow`. Long operations (AI, imports, refreshes) must be added
  to `SLOW_PATHS` in `front/src/lib/api.ts` or the client times out at 60 s.

## Tests

- `unittest`, files `tests/test_<topic>.py`, first line a docstring that says what it covers and
  `Run: python -m unittest discover -s tests`.
- Test pure functions and Pydantic models directly; fake connections with small classes / `SimpleNamespace`
  (see `test_subcategory_defaults.py`). Only `test_registration.py` imports `app.main` and needs a real DB.
- No network in tests: stub fetchers. Test names read as sentences: `test_a_gift_costs_zero_but_a_price_is_never_negative`.
- Every bug fix gets a test that would have caught it.

## Dependencies

`requirements.txt` pins exact versions on purpose. Add a package only if it's really needed, pinned with `==`, and
check that it works on Vercel's Python runtime.
