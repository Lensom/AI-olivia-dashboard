"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { AddDialog } from "@/features/cinema/add-dialog";
import { downloadCsv } from "@/features/cinema/export";
import { cinemaKindBySlug } from "@/features/cinema/nav";
import { errorText, TitleDialog } from "@/features/cinema/title-dialog";
import {
  applyDetails,
  isSeries,
  newSeasons,
  sameTitle,
  showsInCinema,
  STATUSES,
  type CinemaDetails,
  type CinemaStatus,
  type CinemaTitle,
} from "@/features/cinema/types";
import { ImdbRating, Poster, ScoreBadge, SeasonsWatched, StatusPill, Tags } from "@/features/cinema/ui";
import { useLinkedItem } from "@/features/shared/linked-item";
import {
  investingMetaBadge,
  investingPrimarySaveActive,
  investingTableScrollWrap,
  investingToolbarBtn,
  scrollRow,
} from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { facetCounts } from "@/lib/facets";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useCinema } from "@/state/cinema-store";

type SortKey = "score" | "imdb_rating" | "title" | "year" | "view_year" | "added";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "score", label: "Your score" },
  { value: "imdb_rating", label: "IMDb rating" },
  { value: "view_year", label: "Year watched" },
  { value: "year", label: "Release year" },
  { value: "title", label: "Title" },
  { value: "added", label: "Recently added" },
];

type SortDir = "asc" | "desc";
/** The direction a sort starts in: best scores and newest years first, titles A–Z. A second click flips it. */
const defaultDir = (key: SortKey): SortDir => (key === "title" ? "asc" : "desc");

/** Numbers in the given direction; titles without the number go last either way, so they don't crowd the top. */
const byNumber = (a: number | null, b: number | null, dir: SortDir) => {
  if (a == null || b == null) return a == null && b == null ? 0 : a == null ? 1 : -1;
  return dir === "asc" ? a - b : b - a;
};

function sortTitles(list: CinemaTitle[], key: SortKey, dir: SortDir): CinemaTitle[] {
  const byTitle = (a: CinemaTitle, b: CinemaTitle) => a.title.localeCompare(b.title);
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (key === "title") return sign * byTitle(a, b);
    if (key === "added") return sign * a.added_at.localeCompare(b.added_at) || byTitle(a, b);
    const primary = byNumber(a[key], b[key], dir);
    // Ties: higher score, then recommended, then alphabetical.
    return primary || byNumber(a.score, b.score, "desc") || Number(b.recommended) - Number(a.recommended) || byTitle(a, b);
  });
}

/** A column header that sorts the table by its column; clicking it again flips the direction. */
function SortHeader({
  label,
  sortKey,
  sort,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sort === sortKey;
  return (
    <th className="px-3 py-2 font-medium" aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#1f1c17] ${active ? "text-[#1f1c17]" : ""}`}
      >
        {label}
        <span aria-hidden className={active ? "" : "opacity-0"}>
          {dir === "asc" && active ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}

type Dialog = { mode: "add" } | { mode: "edit"; title: CinemaTitle; isNew: boolean } | null;
type ImportPreview = { fresh: CinemaTitle[]; duplicates: number; skipped: number; fileName: string };

export default function CinemaKindPage() {
  const params = useParams<{ kind: string }>();
  const meta = cinemaKindBySlug(params.kind);
  const { token } = useAuth();
  const { items, tmdbEnabled, isLoaded, loadError, update } = useCinema();
  const tr = useT();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CinemaStatus | "all">("all");
  const [genre, setGenre] = useState("");
  const [releaseYear, setReleaseYear] = useState("");
  const [viewYear, setViewYear] = useState("");
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [onlyNewSeasons, setOnlyNewSeasons] = useState(false);
  const [onlyInCinema, setOnlyInCinema] = useState(false);
  const [sort, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Another column starts in its natural direction; the same one again flips it.
  const sortBy = (key: SortKey) => {
    if (key === sort) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(defaultDir(key));
    }
  };
  const [view, setView] = useState<"table" | "posters">("table");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [fill, setFill] = useState<{ open: boolean; replace: boolean; done: number; total: number; running: boolean }>({
    open: false,
    replace: false,
    done: 0,
    total: 0,
    running: false,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = useMemo(() => (meta ? items.filter((t) => t.kind === meta.kind) : []), [items, meta]);
  // A title opened from global search (?open=<id>).
  const { linked, dismiss } = useLinkedItem(mine);
  const editing = dialog?.mode === "edit" ? dialog : linked ? { mode: "edit" as const, title: linked, isNew: false } : null;
  // Whether a title passes the filters. `skip` leaves one filter out: a status chip or a year/genre option counts
  // the titles you'd see after picking it, i.e. with every *other* filter applied. Counting them over the whole
  // list made "Watched in 2026 (27)" show 21 titles while the Watched chip was on.
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (t: CinemaTitle, skip?: "status" | "genre" | "releaseYear" | "viewYear") =>
      (skip === "status" || status === "all" || t.status === status) &&
      (skip === "genre" || !genre || t.genres.includes(genre)) &&
      (skip === "releaseYear" || !releaseYear || String(t.year) === releaseYear) &&
      (skip === "viewYear" || !viewYear || String(t.view_year) === viewYear) &&
      (!onlyRecommended || t.recommended) &&
      (!onlyNewSeasons || newSeasons(t) > 0) &&
      (!onlyInCinema || t.in_cinema) &&
      (!q || [t.title, t.original_title, ...t.actors, ...t.studios, ...t.directors, ...t.genres].some((s) => s.toLowerCase().includes(q)));
  }, [query, status, genre, releaseYear, viewYear, onlyRecommended, onlyNewSeasons, onlyInCinema]);

  const genres = useMemo(
    () => [...facetCounts(mine, (t) => matches(t, "genre"), (t) => t.genres, genre)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [mine, matches, genre],
  );
  // Years present on this page, newest first, with how many titles each would show.
  const yearOptions = useMemo(() => {
    const byYear = (pick: (t: CinemaTitle) => number | null, skip: "releaseYear" | "viewYear", picked: string) =>
      [...facetCounts(mine, (t) => matches(t, skip), (t) => [pick(t)], picked ? Number(picked) : null)].sort((a, b) => b[0] - a[0]);
    return { release: byYear((t) => t.year, "releaseYear", releaseYear), view: byYear((t) => t.view_year, "viewYear", viewYear) };
  }, [mine, matches, releaseYear, viewYear]);
  const statusCounts = useMemo(() => facetCounts(mine, (t) => matches(t, "status"), (t) => [t.status]), [mine, matches]);
  const statusTotal = useMemo(() => [...statusCounts.values()].reduce((a, n) => a + n, 0), [statusCounts]);

  const visible = useMemo(() => sortTitles(mine.filter((t) => matches(t)), sort, sortDir), [mine, matches, sort, sortDir]);
  const inCinemaCount = useMemo(() => mine.filter((t) => t.in_cinema).length, [mine]);

  const missingTmdb = mine.filter((t) => !t.tmdb_id).length;
  const scored = mine.filter((t) => t.score != null);
  const avg = scored.length ? scored.reduce((a, t) => a + (t.score ?? 0), 0) / scored.length : null;

  if (!meta) {
    return (
      <p className="text-sm text-[#655d51]">
        {tr("Unknown page.")} <Link href="/cinematography" className="underline">{tr("Back to Cinematography")}</Link>
      </p>
    );
  }
  const kind = meta.kind;
  const series = isSeries(kind);
  const behindCount = series ? mine.filter((t) => newSeasons(t) > 0).length : 0;

  async function saveTitle(t: CinemaTitle) {
    await update((list) => (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list]));
  }

  async function toggleRecommended(t: CinemaTitle) {
    try {
      await update((list) => list.map((x) => (x.id === t.id ? { ...x, recommended: !x.recommended } : x)));
    } catch (e) {
      setNotice({ tone: "error", text: tr(errorText(e, "Could not save.")) });
    }
  }

  async function onImportFile(file: File) {
    setImporting(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ rows: CinemaTitle[]; skipped: number }>(`/cinema/import?kind=${kind}`, {
        token: token ?? undefined,
        method: "POST",
        body,
      });
      const fresh: CinemaTitle[] = [];
      let duplicates = 0;
      for (const r of res.rows) {
        if (items.some((t) => t.kind === r.kind && sameTitle(t, r)) || fresh.some((t) => t.kind === r.kind && sameTitle(t, r))) duplicates += 1;
        else fresh.push(r);
      }
      setPreview({ fresh, duplicates, skipped: res.skipped, fileName: file.name });
    } catch (e) {
      setNotice({ tone: "error", text: tr(errorText(e, "Import failed.")) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!preview) return;
    try {
      await update((list) => [...preview.fresh, ...list]);
      const n = preview.fresh.length;
      setNotice({
        tone: "ok",
        text: tr("Added {n} titles.", { n }) + (tmdbEnabled ? " " + tr("Use “Fill from TMDB” to add posters and details.") : ""),
      });
      setPreview(null);
    } catch (e) {
      setNotice({ tone: "error", text: tr(errorText(e, "Could not save the import.")) });
    }
  }

  async function runFill() {
    const targets = mine.filter((t) => fill.replace || !t.tmdb_id);
    setFill((f) => ({ ...f, running: true, done: 0, total: targets.length }));
    const found = new Map<string, CinemaDetails>();
    let failed = false;
    for (let i = 0; i < targets.length; i += 20) {
      const chunk = targets.slice(i, i + 20);
      try {
        const res = await apiFetch<(CinemaDetails | null)[]>("/cinema/match-many", {
          token: token ?? undefined,
          method: "POST",
          body: JSON.stringify(chunk),
        });
        res.forEach((d, j) => d && found.set(chunk[j].id, d));
      } catch (e) {
        setNotice({ tone: "error", text: tr(errorText(e, "TMDB lookup failed.")) });
        failed = true;
        break;
      }
      setFill((f) => ({ ...f, done: Math.min(i + 20, targets.length) }));
    }
    try {
      if (found.size) {
        await update((list) => list.map((t) => (found.has(t.id) ? applyDetails(t, found.get(t.id)!, fill.replace) : t)));
      }
      if (!failed) {
        const missed = targets.length - found.size;
        setNotice({
          tone: "ok",
          text:
            tr("Filled {n} titles from TMDB.", { n: found.size }) +
            (missed ? " " + tr("{n} had no match — open them and fix the title or year.", { n: missed }) : ""),
        });
      }
    } catch (e) {
      setNotice({ tone: "error", text: tr(errorText(e, "Could not save.")) });
    }
    setFill((f) => ({ ...f, running: false, open: false }));
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={scrollRow}>
          <span className={investingMetaBadge}>
            {tr(meta.count, { n: mine.length })}
          </span>
          {avg != null ? <span className={investingMetaBadge}>{tr("Average score {v}", { v: avg.toFixed(1) })}</span> : null}
          <span className={investingMetaBadge}>{tr("{n} recommended", { n: mine.filter((t) => t.recommended).length })}</span>
        </div>
        <div className={scrollRow}>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className={investingToolbarBtn}>
            {importing ? tr("Reading…") : tr("Import CSV / XLSX")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xlsm"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
            }}
          />
          {visible.length ? (
            <button
              type="button"
              onClick={() => downloadCsv(visible, `${meta.slug}-${new Date().toISOString().slice(0, 10)}.csv`)}
              className={investingToolbarBtn}
              title={tr("The titles shown, with the current filters and sort")}
            >
              {tr("Export CSV")}
              {visible.length !== mine.length ? ` (${visible.length})` : ""}
            </button>
          ) : null}
          {tmdbEnabled && mine.length ? (
            <button type="button" onClick={() => setFill((f) => ({ ...f, open: !f.open }))} className={investingToolbarBtn}>
              {tr("Fill from TMDB")}
              {missingTmdb ? ` (${missingTmdb})` : ""}
            </button>
          ) : null}
          <button type="button" onClick={() => setDialog({ mode: "add" })} className={investingPrimarySaveActive}>
            + {tr(meta.add)}
          </button>
        </div>
      </div>

      {!tmdbEnabled && isLoaded && !loadError ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          {tr("Posters, search and auto-filled genres / actors / studios come from TMDB. Get a free key at themoviedb.org → Settings → API, put TMDB_API_KEY=… in back/.env and restart the backend.")}
        </p>
      ) : null}
      {loadError ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{tr(loadError)}</p> : null}
      {notice ? (
        <p
          className={`flex items-start justify-between gap-3 rounded-xl px-4 py-2.5 text-sm ${
            notice.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label={tr("Dismiss")} className="opacity-60 hover:opacity-100">
            ×
          </button>
        </p>
      ) : null}

      {preview ? (
        <div className="rounded-2xl border border-black/5 bg-[#faf8f2] p-4">
          <p className="text-sm font-medium text-[#1f1c17]">
            {preview.fileName}: {tr("{n} new titles", { n: preview.fresh.length })}
          </p>
          <p className="mt-0.5 text-xs text-[#6f675b]">
            {[
              preview.duplicates ? tr("{n} already in your list (skipped)", { n: preview.duplicates }) : "",
              preview.skipped ? tr("{n} rows without a title", { n: preview.skipped }) : "",
            ]
              .filter(Boolean)
              .join(" · ") || tr("Nothing to skip.")}
          </p>
          {preview.fresh.length ? (
            <p className="mt-2 line-clamp-2 text-xs text-[#8f8676]">{preview.fresh.slice(0, 12).map((t) => t.title).join(" · ")}{preview.fresh.length > 12 ? " …" : ""}</p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void confirmImport()} disabled={!preview.fresh.length} className={investingPrimarySaveActive}>
              {tr("Add {n}", { n: preview.fresh.length })}
            </button>
            <button type="button" onClick={() => setPreview(null)} className={investingToolbarBtn}>
              {tr("Cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {fill.open ? (
        <div className="rounded-2xl border border-black/5 bg-[#faf8f2] p-4">
          <p className="text-sm font-medium text-[#1f1c17]">{tr("Fill posters, genres, actors and studios from TMDB")}</p>
          <p className="mt-0.5 text-xs text-[#6f675b]">
            {tr("Titles are matched by name and release year. Your score, status, recommendation and notes are never changed.")}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-[#3b352d]">
            <input
              type="checkbox"
              checked={fill.replace}
              onChange={(e) => setFill((f) => ({ ...f, replace: e.target.checked }))}
              disabled={fill.running}
              className="accent-[#2a78d6]"
            />
            {tr("Also refresh titles already matched, and replace my genres, actors and studios with TMDB’s")}
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => void runFill()} disabled={fill.running} className={investingPrimarySaveActive}>
              {fill.running
                ? tr("Matching {done} / {total}…", { done: fill.done, total: fill.total })
                : tr("Fill {n} titles", { n: fill.replace ? mine.length : missingTmdb })}
            </button>
            {!fill.running ? (
              <button type="button" onClick={() => setFill((f) => ({ ...f, open: false }))} className={investingToolbarBtn}>
                {tr("Cancel")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr("Search title, actor, studio…")}
          className="w-full rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs outline-none focus:border-black/25 sm:w-60"
        />
        <div className={`${scrollRow} sm:contents`}>
        <button type="button" onClick={() => setStatus("all")} className={chip(status === "all")}>
          {tr("All")} {statusTotal}
        </button>
        {STATUSES.filter((s) => statusCounts.get(s.value) || status === s.value).map((s) => (
          <button key={s.value} type="button" onClick={() => setStatus(s.value)} className={chip(status === s.value)}>
            {tr(s.label)} {statusCounts.get(s.value) ?? 0}
          </button>
        ))}
        <button type="button" onClick={() => setOnlyRecommended((v) => !v)} className={chip(onlyRecommended)} aria-pressed={onlyRecommended}>
          ✓ {tr("Recommended")}
        </button>
        {showsInCinema(kind) && (inCinemaCount || onlyInCinema) ? (
          <button type="button" onClick={() => setOnlyInCinema((v) => !v)} className={chip(onlyInCinema)} aria-pressed={onlyInCinema}>
            🎬 {tr("In the cinema")} {inCinemaCount}
          </button>
        ) : null}
        {behindCount ? (
          <button type="button" onClick={() => setOnlyNewSeasons((v) => !v)} className={chip(onlyNewSeasons)} aria-pressed={onlyNewSeasons}>
            {tr("New seasons")} {behindCount}
          </button>
        ) : null}
        {genres.length ? (
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]" aria-label={tr("Genre")}>
            <option value="">{tr("All genres")}</option>
            {genres.map(([g, n]) => (
              <option key={g} value={g}>
                {g} ({n})
              </option>
            ))}
          </select>
        ) : null}
        {yearOptions.release.length ? (
          <select
            value={releaseYear}
            onChange={(e) => setReleaseYear(e.target.value)}
            className={`rounded-full border px-3 py-1 text-xs ${releaseYear ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d]"}`}
            aria-label={tr("Release year")}
          >
            <option value="">{tr("Any release year")}</option>
            {yearOptions.release.map(([y, n]) => (
              <option key={y} value={y}>
                {tr("Released {year}", { year: y })} ({n})
              </option>
            ))}
          </select>
        ) : null}
        {yearOptions.view.length ? (
          <select
            value={viewYear}
            onChange={(e) => setViewYear(e.target.value)}
            className={`rounded-full border px-3 py-1 text-xs ${viewYear ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d]"}`}
            aria-label={tr("Year watched")}
          >
            <option value="">{tr("Any year watched")}</option>
            {yearOptions.view.map(([y, n]) => (
              <option key={y} value={y}>
                {tr("Watched in {year}", { year: y })} ({n})
              </option>
            ))}
          </select>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => {
              const key = e.target.value as SortKey;
              setSortKey(key);
              setSortDir(defaultDir(key));
            }}
            className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]"
            aria-label={tr("Sort by")}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {tr("Sort: {v}", { v: tr(s.label) })}
              </option>
            ))}
          </select>
          {/* Posters and phones have no column headers to click: the direction lives here too. */}
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-xs text-[#3b352d] hover:bg-[#faf8f2]"
            aria-label={sortDir === "asc" ? tr("Ascending: tap for descending") : tr("Descending: tap for ascending")}
            title={sortDir === "asc" ? tr("Ascending: tap for descending") : tr("Descending: tap for ascending")}
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
          <span className="inline-flex rounded-full border border-black/10 bg-white p-0.5">
            {(["table", "posters"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${view === v ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b]"}`}
              >
                {v === "table" ? tr("Table") : tr("Posters")}
              </button>
            ))}
          </span>
        </span>
        </div>
      </div>

      {!isLoaded ? (
        <p className="text-sm text-[#8f8676]">{tr("Loading…")}</p>
      ) : !mine.length ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center">
          <p className="text-sm font-medium text-[#1f1c17]">{tr("Nothing here yet")}</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[#6f675b]">
            {tr("Add one from the TMDB search, or import your Notion table: in Notion use ••• → Export → Markdown & CSV, then upload the .csv here. Columns like Title, Genre, Status, Score, Year, View Year, Studio / Distributor, Actors and the checkbox are recognised (English or Ukrainian).")}
          </p>
        </div>
      ) : !visible.length ? (
        <p className="text-sm text-[#8f8676]">{tr("Nothing matches these filters.")}</p>
      ) : view === "table" ? (
        <>
        {/* Phones: a compact card per title instead of the 11-column table. Tap to open it. */}
        <ul className="space-y-2 sm:hidden">
          {visible.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setDialog({ mode: "edit", title: t, isNew: false })}
                className="flex w-full gap-3 rounded-2xl border border-black/5 bg-white/90 p-2.5 text-left shadow-[0_4px_16px_rgba(18,16,13,0.04)] active:bg-[#faf8f2]"
              >
                <Poster src={t.poster} title={t.title} className="h-[84px] w-14 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <span className="line-clamp-2 text-sm font-medium leading-snug text-[#1f1c17]">{t.title}</span>
                      {t.original_title && t.original_title !== t.title ? (
                        <span className="block truncate text-[11px] text-[#8f8676]">{t.original_title}</span>
                      ) : null}
                    </span>
                    <span className="shrink-0">
                      <ScoreBadge score={t.score} />
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs text-[#6f675b]">
                    {t.year != null ? (
                      <span className={t.in_cinema ? "font-semibold text-emerald-600" : ""} title={t.in_cinema ? tr("Watched in the cinema") : undefined}>
                        {t.year}
                        {t.in_cinema ? " 🎬" : ""}
                      </span>
                    ) : null}
                    {[
                      series && t.watched_seasons ? `S${t.watched_seasons}${t.seasons ? `/${t.seasons}` : ""}` : "",
                      t.genres.slice(0, 2).join(", "),
                    ]
                      .filter(Boolean)
                      .map((x) => ` · ${x}`)
                      .join("")}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <StatusPill status={t.status} />
                    {t.imdb_rating != null ? <ImdbRating rating={t.imdb_rating} votes={t.imdb_votes} imdbId="" /> : null}
                    {t.recommended ? (
                      <span className="rounded-md bg-[#2a78d6] px-1.5 py-0.5 text-[10px] font-semibold text-white">✓ {tr("Rec.")}</span>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className={`${investingTableScrollWrap} hidden sm:block`}>
          <table className="w-full min-w-[1060px] text-left text-sm">
            <thead className="bg-[#faf8f2] text-[11px] uppercase tracking-wide text-[#8f8676]">
              <tr>
                <th className="w-10 px-3 py-2 font-medium" title={tr("I recommend it")}>
                  <span className="sr-only">{tr("Recommended")}</span>✓
                </th>
                <SortHeader label={tr("Title")} sortKey="title" sort={sort} dir={sortDir} onSort={sortBy} />
                <th className="px-3 py-2 font-medium">{tr("Genre")}</th>
                <th className="px-3 py-2 font-medium">{tr("Status")}</th>
                {series ? (
                  <th className="px-3 py-2 font-medium" title={tr("Watched up to season / seasons released")}>
                    {tr("Seasons")}
                  </th>
                ) : null}
                <SortHeader label={tr("Score")} sortKey="score" sort={sort} dir={sortDir} onSort={sortBy} />
                <SortHeader label="IMDb" sortKey="imdb_rating" sort={sort} dir={sortDir} onSort={sortBy} />
                <SortHeader label={tr("Year")} sortKey="year" sort={sort} dir={sortDir} onSort={sortBy} />
                <SortHeader label={tr("Year watched")} sortKey="view_year" sort={sort} dir={sortDir} onSort={sortBy} />
                <th className="px-3 py-2 font-medium">{tr("Studio / distributor")}</th>
                <th className="px-3 py-2 font-medium">{tr("Actors")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 bg-white">
              {visible.map((t) => (
                <tr key={t.id} className="cursor-pointer align-top transition hover:bg-[#fcfbf7]" onClick={() => setDialog({ mode: "edit", title: t, isNew: false })}>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={t.recommended}
                      onChange={() => void toggleRecommended(t)}
                      aria-label={tr("Recommend {title}", { title: t.title })}
                      className="h-4 w-4 cursor-pointer accent-[#2a78d6]"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-start gap-2.5">
                      <Poster src={t.poster} title={t.title} className="h-12 w-8 shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-[#1f1c17]">{t.title}</span>
                        {t.original_title && t.original_title !== t.title ? (
                          <span className="block text-xs text-[#8f8676]">{t.original_title}</span>
                        ) : null}
                        {t.notes ? <span className="mt-0.5 line-clamp-1 block text-xs text-[#6f675b]">{t.notes}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="max-w-[180px] px-3 py-2.5"><Tags items={t.genres} max={3} /></td>
                  <td className="px-3 py-2.5"><StatusPill status={t.status} /></td>
                  {series ? <td className="px-3 py-2.5 text-sm"><SeasonsWatched watched={t.watched_seasons} total={t.seasons} /></td> : null}
                  <td className="px-3 py-2.5"><ScoreBadge score={t.score} /></td>
                  <td className="px-3 py-2.5"><ImdbRating rating={t.imdb_rating} votes={t.imdb_votes} imdbId={t.imdb_id} /></td>
                  <td
                    className={`px-3 py-2.5 tabular-nums ${t.in_cinema ? "font-semibold text-emerald-600" : "text-[#3b352d]"}`}
                    title={t.in_cinema ? tr("Watched in the cinema") : undefined}
                  >
                    {t.year ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[#3b352d]">{t.view_year ?? "—"}</td>
                  <td className="max-w-[180px] px-3 py-2.5"><Tags items={t.studios} max={2} /></td>
                  <td className="max-w-[260px] px-3 py-2.5"><Tags items={t.actors} max={4} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {visible.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setDialog({ mode: "edit", title: t, isNew: false })} className="group block w-full text-left">
                <span className="relative block">
                  <Poster src={t.poster} title={t.title} className="aspect-[2/3] w-full text-2xl shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md" />
                  <span className="absolute left-1.5 top-1.5"><ScoreBadge score={t.score} /></span>
                  {t.recommended ? (
                    <span className="absolute right-1.5 top-1.5 rounded-md bg-[#2a78d6] px-1.5 py-0.5 text-[11px] font-semibold text-white">✓ {tr("Rec.")}</span>
                  ) : null}
                </span>
                <span className="mt-1.5 block truncate text-sm font-medium text-[#1f1c17]">{t.title}</span>
                <span className="block truncate text-xs text-[#8f8676]">
                  {[t.year, series && t.watched_seasons ? `S${t.watched_seasons}${t.seasons ? `/${t.seasons}` : ""}` : "", t.genres.slice(0, 2).join(", ")].filter(Boolean).join(" · ")}
                  {t.status !== "watched" ? ` · ${tr(STATUSES.find((s) => s.value === t.status)?.label ?? "")}` : ""}
                </span>
                {t.imdb_rating != null ? (
                  <span className="mt-0.5 block text-xs">
                    <ImdbRating rating={t.imdb_rating} votes={t.imdb_votes} imdbId="" />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog?.mode === "add" ? (
        <AddDialog
          kind={kind}
          tmdbEnabled={tmdbEnabled}
          existing={items}
          onClose={() => setDialog(null)}
          onPick={(t) => setDialog({ mode: "edit", title: t, isNew: true })}
          onOpenExisting={(t) => setDialog({ mode: "edit", title: t, isNew: false })}
        />
      ) : null}
      {editing ? (
        <TitleDialog
          key={editing.title.id}
          initial={editing.title}
          isNew={editing.isNew}
          tmdbEnabled={tmdbEnabled}
          onClose={() => {
            setDialog(null);
            dismiss();
          }}
          onSave={saveTitle}
          onDelete={editing.isNew ? undefined : () => update((list) => list.filter((x) => x.id !== editing.title.id))}
        />
      ) : null}
    </div>
  );
}
