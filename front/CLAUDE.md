@AGENTS.md

# Frontend (Next.js 16)

## Layout

- `src/app/…`: routes. Pages are `"use client"` and wrapped in `<RequireAuth>`.
- `src/features/<section>/`: section code: `nav.ts` (tabs), `types.ts` (types + pure helpers), dialogs, charts.
  Shared pieces live in `features/shared/` and `components/layout/`.
- `src/state/*-store.tsx`: React context stores for big sections (investing, cinema, library…). Smaller Life pages
  load and save their own document with `apiFetch` directly (see `app/life/purchases/page.tsx`).
- `src/lib/api.ts`: the only way to call the backend. It handles base URL, auth header, timeouts, `X-Base-Version`,
  401 → logout event and 409 → conflict banner. Never call `fetch` for the API directly.
- `src/lib/features.ts`: switches to hide whole sections.

## i18n (EN / UA)

- Every visible string goes through `const t = useT()`: `t("Add task")`, `t("{n} items", { n })`.
  The English text is the key.
- Add the Ukrainian translation to the matching dictionary in `src/lib/i18n/` (`common.ts`, `media.ts`,
  `investing.ts`, `pages.ts`). Plurals: UK value is `[one, few, many]`, and the English forms go in `EN_PLURALS` (`uk.ts`).
- Dates/numbers are formatted with `useLocale()`. User data (titles, notes, names) is never translated.

## Styling

Tailwind 4 utility classes inline. The palette is warm neutrals (`#1f1c17`, `#3b352d`, `#faf8f2`, `#f8f4eb`,
`border-black/5`–`/10`, `rounded-2xl` cards). Reuse class constants like `card`, `field`, `btn`, `chip` from nearby
pages or `lib/filter-classes.ts` instead of inventing new looks. Must work on a phone: inputs at least 16px
(iOS zoom), tables usable when narrow.

## UX conventions

- Saved data shows immediately; live/slow data (quotes, AI, TMDB) fills in after it arrives with a loading state,
  and an error never hides the user's own data.
- Text links that come from user data render only if `http(s)://`.
- Small preferences (chosen currency, filters) persist in `localStorage` under an `olivia.<section>.<what>` key.

## Checks

`npx tsc --noEmit` and `npm run lint` must pass (CI also runs `npm run build`). `react-hooks/set-state-in-effect`
is a known warning in stores. Don't add new warnings elsewhere.
