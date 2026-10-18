"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { errorText } from "@/features/cinema/title-dialog";
import { Poster, Tags } from "@/features/cinema/ui";
import { AddBookDialog } from "@/features/library/add-dialog";
import { BookDialog } from "@/features/library/book-dialog";
import { libraryKindBySlug } from "@/features/library/nav";
import {
  applyBookDetails,
  formatDate,
  hasVolumes,
  READ_STATUSES,
  type LibraryDetails,
  type LibraryItem,
  type LibraryStatus,
} from "@/features/library/types";
import { ReadersRating, ReadStatusPill, Stars } from "@/features/library/ui";
import {
  investingMetaBadge,
  investingPrimarySaveActive,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/state/auth-store";
import { useLibrary } from "@/state/library-store";

type SortKey = "score" | "finished" | "title" | "author" | "year" | "pages" | "added";
const SORTS: { value: SortKey; label: string }[] = [
  { value: "score", label: "Your score" },
  { value: "finished", label: "Date finished" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
  { value: "year", label: "Published" },
  { value: "pages", label: "Pages" },
  { value: "added", label: "Recently added" },
];

function sortItems(list: LibraryItem[], key: SortKey): LibraryItem[] {
  const byTitle = (a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title);
  const num = (a: number | null, b: number | null) => (b ?? -Infinity) - (a ?? -Infinity);
  return [...list].sort((a, b) => {
    switch (key) {
      case "title":
        return byTitle(a, b);
      case "author":
        return (a.authors[0] ?? "￿").localeCompare(b.authors[0] ?? "￿") || byTitle(a, b);
      case "finished":
        return b.finish_date.localeCompare(a.finish_date) || byTitle(a, b);
      case "added":
        return b.added_at.localeCompare(a.added_at) || byTitle(a, b);
      case "year":
        return num(a.year, b.year) || byTitle(a, b);
      case "pages":
        return num(a.pages, b.pages) || byTitle(a, b);
      default:
        // Like the Notion table: best score first, then most recently finished.
        return num(a.score, b.score) || b.finish_date.localeCompare(a.finish_date) || byTitle(a, b);
    }
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const sameBook = (a: LibraryItem, b: LibraryItem) =>
  a.kind === b.kind && norm(a.title) === norm(b.title) && (!a.authors.length || !b.authors.length || norm(a.authors[0]) === norm(b.authors[0]));

type Dialog = { mode: "add" } | { mode: "edit"; item: LibraryItem; isNew: boolean } | null;
type ImportPreview = { fresh: LibraryItem[]; duplicates: number; skipped: number; fileName: string };

export default function LibraryKindPage() {
  const params = useParams<{ kind: string }>();
  const meta = libraryKindBySlug(params.kind);
  const { token } = useAuth();
  const { items, googleEnabled, isLoaded, loadError, update } = useLibrary();

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<LibraryStatus | "all">("all");
  const [genre, setGenre] = useState("");
  const [finishedYear, setFinishedYear] = useState("");
  const [onlyRecommended, setOnlyRecommended] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [view, setView] = useState<"table" | "covers">("table");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importing, setImporting] = useState(false);
  const [fill, setFill] = useState({ open: false, replace: false, done: 0, total: 0, running: false });
  const fileRef = useRef<HTMLInputElement>(null);

  const mine = useMemo(() => (meta ? items.filter((t) => t.kind === meta.kind) : []), [items, meta]);
  const genres = useMemo(() => {
    const c = new Map<string, number>();
    for (const t of mine) for (const g of t.genres) c.set(g, (c.get(g) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [mine]);
  const years = useMemo(() => [...new Set(mine.map((t) => t.finish_date.slice(0, 4)).filter(Boolean))].sort().reverse(), [mine]);
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of mine) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [mine]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortItems(
      mine.filter(
        (t) =>
          (status === "all" || t.status === status) &&
          (!genre || t.genres.includes(genre)) &&
          (!finishedYear || t.finish_date.startsWith(finishedYear)) &&
          (!onlyRecommended || t.recommended) &&
          (!q || [t.title, t.original_title, ...t.authors, ...t.genres, t.publisher].some((s) => s.toLowerCase().includes(q))),
      ),
      sort,
    );
  }, [mine, query, status, genre, finishedYear, onlyRecommended, sort]);

  if (!meta) {
    return (
      <p className="text-sm text-[#655d51]">
        Unknown page. <Link href="/library" className="underline">Back to Library</Link>
      </p>
    );
  }
  const kind = meta.kind;
  const volumes = hasVolumes(kind);
  const unmatched = mine.filter((t) => !t.source_id).length;
  const scored = mine.filter((t) => t.score != null);
  const avg = scored.length ? scored.reduce((a, t) => a + (t.score ?? 0), 0) / scored.length : null;

  async function saveItem(t: LibraryItem) {
    await update((list) => (list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [t, ...list]));
  }

  async function toggleRecommended(t: LibraryItem) {
    try {
      await update((list) => list.map((x) => (x.id === t.id ? { ...x, recommended: !x.recommended } : x)));
    } catch (e) {
      setNotice({ tone: "error", text: errorText(e, "Could not save.") });
    }
  }

  async function onImportFile(file: File) {
    setImporting(true);
    setNotice(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await apiFetch<{ rows: LibraryItem[]; skipped: number }>(`/library/import?kind=${kind}`, { token: token ?? undefined, method: "POST", body });
      const fresh: LibraryItem[] = [];
      let duplicates = 0;
      for (const r of res.rows) {
        if (items.some((t) => sameBook(t, r)) || fresh.some((t) => sameBook(t, r))) duplicates += 1;
        else fresh.push(r);
      }
      setPreview({ fresh, duplicates, skipped: res.skipped, fileName: file.name });
    } catch (e) {
      setNotice({ tone: "error", text: errorText(e, "Import failed.") });
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
      setNotice({ tone: "ok", text: `Added ${n} title${n === 1 ? "" : "s"}. Use “Fill covers & details” to add covers, pages and descriptions.` });
      setPreview(null);
    } catch (e) {
      setNotice({ tone: "error", text: errorText(e, "Could not save the import.") });
    }
  }

  async function runFill() {
    const targets = mine.filter((t) => fill.replace || !t.source_id);
    setFill((f) => ({ ...f, running: true, done: 0, total: targets.length }));
    const found = new Map<string, LibraryDetails>();
    let failed = false;
    for (let i = 0; i < targets.length; i += 20) {
      const chunk = targets.slice(i, i + 20);
      try {
        const res = await apiFetch<(LibraryDetails | null)[]>("/library/match-many", {
          token: token ?? undefined,
          method: "POST",
          body: JSON.stringify(chunk.map((t) => ({ id: t.id, kind: t.kind, title: t.title, authors: t.authors, source: t.source, source_id: t.source_id }))),
        });
        res.forEach((d, j) => d && found.set(chunk[j].id, d));
      } catch (e) {
        setNotice({ tone: "error", text: errorText(e, "Lookup failed.") });
        failed = true;
        break;
      }
      setFill((f) => ({ ...f, done: Math.min(i + 20, targets.length) }));
    }
    try {
      if (found.size) await update((list) => list.map((t) => (found.has(t.id) ? applyBookDetails(t, found.get(t.id)!, fill.replace) : t)));
      if (!failed) {
        const missed = targets.length - found.size;
        setNotice({
          tone: "ok",
          text: `Filled ${found.size} title${found.size === 1 ? "" : "s"}.${
            missed ? ` ${missed} had no match — catalogues rarely list Ukrainian editions: open them and use “Find cover & details” with the English title.` : ""
          }`,
        });
      }
    } catch (e) {
      setNotice({ tone: "error", text: errorText(e, "Could not save.") });
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
        <div className="flex flex-wrap items-center gap-2">
          <span className={investingMetaBadge}>
            {mine.length} {mine.length === 1 ? meta.singular : meta.label.toLowerCase()}
          </span>
          {avg != null ? <span className={investingMetaBadge}>Average ★ {avg.toFixed(1)}</span> : null}
          <span className={investingMetaBadge}>{mine.filter((t) => t.recommended).length} recommended</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={importing} className={investingToolbarBtn}>
            {importing ? "Reading…" : "Import CSV / XLSX"}
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
          {mine.length ? (
            <button type="button" onClick={() => setFill((f) => ({ ...f, open: !f.open }))} className={investingToolbarBtn}>
              Fill covers &amp; details{unmatched ? ` (${unmatched})` : ""}
            </button>
          ) : null}
          <button type="button" onClick={() => setDialog({ mode: "add" })} className={investingPrimarySaveActive}>
            + Add {meta.singular}
          </button>
        </div>
      </div>

      {loadError ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{loadError}</p> : null}
      {notice ? (
        <p className={`flex items-start justify-between gap-3 rounded-xl px-4 py-2.5 text-sm ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"}`}>
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="opacity-60 hover:opacity-100">
            ×
          </button>
        </p>
      ) : null}

      {preview ? (
        <div className="rounded-2xl border border-black/5 bg-[#faf8f2] p-4">
          <p className="text-sm font-medium text-[#1f1c17]">
            {preview.fileName}: {preview.fresh.length} new {preview.fresh.length === 1 ? "title" : "titles"}
          </p>
          <p className="mt-0.5 text-xs text-[#6f675b]">
            {[preview.duplicates ? `${preview.duplicates} already in your library (skipped)` : "", preview.skipped ? `${preview.skipped} rows without a title` : ""]
              .filter(Boolean)
              .join(" · ") || "Nothing to skip."}
          </p>
          {preview.fresh.length ? (
            <p className="mt-2 line-clamp-2 text-xs text-[#8f8676]">
              {preview.fresh.slice(0, 12).map((t) => t.title).join(" · ")}
              {preview.fresh.length > 12 ? " …" : ""}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void confirmImport()} disabled={!preview.fresh.length} className={investingPrimarySaveActive}>
              Add {preview.fresh.length}
            </button>
            <button type="button" onClick={() => setPreview(null)} className={investingToolbarBtn}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {fill.open ? (
        <div className="rounded-2xl border border-black/5 bg-[#faf8f2] p-4">
          <p className="text-sm font-medium text-[#1f1c17]">Fill covers, pages, year and descriptions</p>
          <p className="mt-0.5 text-xs text-[#6f675b]">
            Matched by title and author on {googleEnabled ? "Google Books and Open Library" : "Open Library"}. Your score, status, date, ✓ and notes are never changed.
            {googleEnabled ? "" : " Ukrainian titles rarely match there; adding GOOGLE_BOOKS_API_KEY to back/.env helps a lot."}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-[#3b352d]">
            <input
              type="checkbox"
              checked={fill.replace}
              onChange={(e) => setFill((f) => ({ ...f, replace: e.target.checked }))}
              disabled={fill.running}
              className="accent-[#2a78d6]"
            />
            Also refresh titles already matched, and replace my authors and genres with the catalogue&apos;s
          </label>
          <div className="mt-3 flex items-center gap-2">
            <button type="button" onClick={() => void runFill()} disabled={fill.running} className={investingPrimarySaveActive}>
              {fill.running ? `Matching ${fill.done} / ${fill.total}…` : `Fill ${fill.replace ? mine.length : unmatched} titles`}
            </button>
            {!fill.running ? (
              <button type="button" onClick={() => setFill((f) => ({ ...f, open: false }))} className={investingToolbarBtn}>
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title, author, genre…"
          className="w-full rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs outline-none focus:border-black/25 sm:w-60"
        />
        <button type="button" onClick={() => setStatus("all")} className={chip(status === "all")}>
          All {mine.length}
        </button>
        {READ_STATUSES.filter((s) => statusCounts[s.value]).map((s) => (
          <button key={s.value} type="button" onClick={() => setStatus(s.value)} className={chip(status === s.value)}>
            {s.label} {statusCounts[s.value]}
          </button>
        ))}
        <button type="button" onClick={() => setOnlyRecommended((v) => !v)} className={chip(onlyRecommended)} aria-pressed={onlyRecommended}>
          ✓ Recommended
        </button>
        {genres.length ? (
          <select value={genre} onChange={(e) => setGenre(e.target.value)} className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]" aria-label="Genre">
            <option value="">All genres</option>
            {genres.map(([g, n]) => (
              <option key={g} value={g}>
                {g} ({n})
              </option>
            ))}
          </select>
        ) : null}
        {years.length ? (
          <select value={finishedYear} onChange={(e) => setFinishedYear(e.target.value)} className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]" aria-label="Year finished">
            <option value="">Any year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                Finished in {y}
              </option>
            ))}
          </select>
        ) : null}
        <span className="ml-auto flex items-center gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]" aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <span className="inline-flex rounded-full border border-black/10 bg-white p-0.5">
            {(["table", "covers"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${view === v ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b]"}`}
              >
                {v === "table" ? "Table" : "Covers"}
              </button>
            ))}
          </span>
        </span>
      </div>

      {!isLoaded ? (
        <p className="text-sm text-[#8f8676]">Loading…</p>
      ) : !mine.length ? (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center">
          <p className="text-sm font-medium text-[#1f1c17]">No {meta.label.toLowerCase()} yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[#6f675b]">
            Add one from the search, or import your Notion table: ••• → Export → Markdown &amp; CSV, then upload the .csv here. Title, Genre (Jenre), Status,
            Score (⭐), Author, Finish date and the checkbox are recognised.
          </p>
        </div>
      ) : !visible.length ? (
        <p className="text-sm text-[#8f8676]">Nothing matches these filters.</p>
      ) : view === "table" ? (
        <div className={investingTableScrollWrap}>
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="bg-[#faf8f2] text-[11px] uppercase tracking-wide text-[#8f8676]">
              <tr>
                <th className="w-10 px-3 py-2 font-medium" title="I recommend it">
                  <span className="sr-only">Recommended</span>✓
                </th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Genre</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Score</th>
                <th className="px-3 py-2 font-medium">Author</th>
                <th className="px-3 py-2 font-medium">Finished</th>
                {volumes ? <th className="px-3 py-2 font-medium">Volumes</th> : <th className="px-3 py-2 font-medium">Pages</th>}
                <th className="px-3 py-2 font-medium" title="Readers' average on the catalogue">Readers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5 bg-white">
              {visible.map((t) => (
                <tr key={t.id} className="cursor-pointer align-top transition hover:bg-[#fcfbf7]" onClick={() => setDialog({ mode: "edit", item: t, isNew: false })}>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={t.recommended}
                      onChange={() => void toggleRecommended(t)}
                      aria-label={`Recommend ${t.title}`}
                      className="h-4 w-4 cursor-pointer accent-[#2a78d6]"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex items-start gap-2.5">
                      <Poster src={t.cover} title={t.title} className="h-12 w-8 shrink-0" />
                      <span className="min-w-0">
                        <span className="block font-medium text-[#1f1c17]">{t.title}</span>
                        {t.notes ? <span className="mt-0.5 line-clamp-1 block text-xs text-[#6f675b]">{t.notes}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="max-w-[200px] px-3 py-2.5">
                    <Tags items={t.genres} max={3} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ReadStatusPill status={t.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Stars score={t.score} />
                  </td>
                  <td className="max-w-[180px] px-3 py-2.5 text-[#2f2922]">{t.authors.join(", ") || <span className="text-[#b5ad9f]">—</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[#3b352d]">{formatDate(t.finish_date) || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[#3b352d]">
                    {volumes
                      ? t.volumes_read != null
                        ? `${t.volumes_read}${t.volumes_total ? ` / ${t.volumes_total}` : ""}`
                        : "—"
                      : (t.pages ?? "—")}
                  </td>
                  <td className="px-3 py-2.5">
                    <ReadersRating rating={t.source_rating} votes={t.source_votes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {visible.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setDialog({ mode: "edit", item: t, isNew: false })} className="group block w-full text-left">
                <span className="relative block">
                  <Poster src={t.cover} title={t.title} className="aspect-[2/3] w-full text-2xl shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md" />
                  {t.recommended ? (
                    <span className="absolute right-1.5 top-1.5 rounded-md bg-[#2a78d6] px-1.5 py-0.5 text-[11px] font-semibold text-white">✓ Rec.</span>
                  ) : null}
                </span>
                <span className="mt-1.5 block truncate text-sm font-medium text-[#1f1c17]">{t.title}</span>
                <span className="block truncate text-xs text-[#8f8676]">{t.authors.join(", ")}</span>
                <span className="mt-0.5 block">
                  <Stars score={t.score} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {dialog?.mode === "add" ? (
        <AddBookDialog
          kind={kind}
          googleEnabled={googleEnabled}
          existing={items}
          onClose={() => setDialog(null)}
          onPick={(t) => setDialog({ mode: "edit", item: t, isNew: true })}
          onOpenExisting={(t) => setDialog({ mode: "edit", item: t, isNew: false })}
        />
      ) : null}
      {dialog?.mode === "edit" ? (
        <BookDialog
          key={dialog.item.id}
          initial={dialog.item}
          isNew={dialog.isNew}
          onClose={() => setDialog(null)}
          onSave={saveItem}
          onDelete={dialog.isNew ? undefined : () => update((list) => list.filter((x) => x.id !== dialog.item.id))}
        />
      ) : null}
    </div>
  );
}
