---
name: new-life-section
description: Checklist for adding a new section/page (e.g. a Life page like Purchases or Improvements) end to end in Olivia — DB table, router, menu defaults, nav, page, i18n, tests, README. Use when the user asks to add a new page, tab or section.
---

# Adding a new section

Reference implementation: commit `04d42bd` (Life → Purchases). `git show 04d42bd --stat` lists every file it touched.
Ask the user for: slug, menu label, what one item holds, and which section it belongs to (default: `life`).

## Backend

1. **Table** in `back/app/db.py::init_db`: `CREATE TABLE IF NOT EXISTS <name> (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());` with a one-line comment naming the router.
2. **Router** `back/app/<slug>/__init__.py` (empty) + `router.py`, copied from `app/purchases/router.py`:
   module docstring (what and why), bounded Pydantic models, `GET ""` and `PUT ""` with `check_base_version`.
3. **Register** in `back/app/main.py`: import + `app.include_router(<slug>_router, prefix=API_PREFIX)`.
4. **Menu default**: append `("<Label>", "<slug>")` to the section in `_DEFAULTS`, `back/app/categories/router.py`.
5. **Tests**: `back/tests/test_<slug>.py` for the model (defaults, limits, bad input), and update the expected slug lists
   in `tests/test_subcategory_defaults.py` (two places).

## Frontend

6. **Nav**: add `{ slug, label }` to `front/src/features/<section>/nav.ts` in the same order as `_DEFAULTS`.
7. **Types/helpers**: `front/src/features/<section>/<slug>/types.ts`, with types mirroring the Pydantic model, a
   `read…()` that normalises an old/partial document, and pure helpers.
8. **Page**: `front/src/app/<section>/<slug>/page.tsx`, `"use client"`, `<RequireAuth>`, load with `apiFetch` GET, save
   with PUT of the whole document. Reuse the style constants from a neighbour page.
9. **i18n**: Ukrainian for every new string in `front/src/lib/i18n/*.ts`; plural keys also in `EN_PLURALS`.
10. If any call is slow (AI, import, external lookups), add its path to `SLOW_PATHS` in `front/src/lib/api.ts`.

## Finish

11. README: add a `### <Label>` under the section's Features, a row in **API overview**, and the module in
    **Project structure** if it's new there.
12. Run backend tests, then `npx tsc --noEmit` and `npm run lint` in `front/`. Report results.
