"use client";

import { useState } from "react";
import { errorText } from "@/features/cinema/title-dialog";
import { splitList } from "@/features/cinema/types";
import { fieldInput, fieldLabel, Modal, Poster } from "@/features/cinema/ui";
import { libraryKindMeta } from "@/features/library/nav";
import { applyBookDetails, hasVolumes, READ_STATUSES, type LibraryDetails, type LibraryItem } from "@/features/library/types";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const intOrNull = (s: string, max = 100000) => {
  const n = Number(s.trim());
  return s.trim() && Number.isInteger(n) && n > 0 && n < max ? n : null;
};

type Props = {
  initial: LibraryItem;
  isNew: boolean;
  onSave: (t: LibraryItem) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

export function BookDialog({ initial, isNew, onSave, onDelete, onClose }: Props) {
  const { token } = useAuth();
  const tr = useT();
  const locale = useLocale();
  const [t, setT] = useState(initial);
  // Lists and numbers are edited as text so they can be typed freely.
  const [text, setText] = useState({
    authors: initial.authors.join(", "),
    genres: initial.genres.join(", "),
    year: initial.year?.toString() ?? "",
    pages: initial.pages?.toString() ?? "",
    volumes_read: initial.volumes_read?.toString() ?? "",
    volumes_total: initial.volumes_total?.toString() ?? "",
  });
  const [busy, setBusy] = useState<null | "save" | "delete" | "lookup">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof LibraryItem>(key: K, value: LibraryItem[K]) => setT((p) => ({ ...p, [key]: value }));
  const setField = (key: keyof typeof text, value: string) => setText((p) => ({ ...p, [key]: value }));
  const current = (): LibraryItem => ({
    ...t,
    title: t.title.trim(),
    authors: splitList(text.authors),
    genres: splitList(text.genres),
    year: intOrNull(text.year, 2200),
    pages: intOrNull(text.pages),
    volumes_read: intOrNull(text.volumes_read, 1000),
    volumes_total: intOrNull(text.volumes_total, 1000),
  });

  /** Refresh the linked catalogue entry, or (`rematch`) look the book up again by title and author. */
  async function lookup(rematch: boolean) {
    setBusy("lookup");
    setError(null);
    try {
      const c = current();
      const [d] = await apiFetch<(LibraryDetails | null)[]>("/library/match-many", {
        token: token ?? undefined,
        method: "POST",
        body: JSON.stringify([{ id: c.id, kind: c.kind, title: c.title, authors: c.authors, source: rematch ? "" : c.source, source_id: rematch ? "" : c.source_id }]),
      });
      if (!d) {
        setError("No match. Try the English title (catalogues rarely list Ukrainian editions), or check the author.");
        return;
      }
      const next = applyBookDetails(c, d, false);
      setT(next);
      setText((p) => ({
        ...p,
        authors: next.authors.join(", "),
        genres: next.genres.join(", "),
        year: next.year?.toString() ?? "",
        pages: next.pages?.toString() ?? "",
      }));
    } catch (e) {
      setError(errorText(e, "Lookup failed."));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const c = current();
    if (!c.title) {
      setError("Title is required.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      await onSave(c);
      onClose();
    } catch (e) {
      setError(errorText(e, "Could not save."));
      setBusy(null);
    }
  }

  async function remove() {
    if (!onDelete) return;
    setBusy("delete");
    try {
      await onDelete();
      onClose();
    } catch (e) {
      setError(errorText(e, "Could not delete."));
      setBusy(null);
    }
  }

  const meta = libraryKindMeta(t.kind);
  const facts = [
    t.publisher,
    t.pages ? tr("{n} pages", { n: t.pages }) : "",
    t.source_rating ? `${tr("Readers")} ★ ${t.source_rating.toFixed(1)}${t.source_votes ? ` (${t.source_votes.toLocaleString(locale)})` : ""}` : "",
    t.isbn ? `ISBN ${t.isbn}` : "",
  ].filter(Boolean);
  const sourceUrl =
    t.source === "openlibrary" && t.source_id
      ? `https://openlibrary.org${t.source_id}`
      : t.source === "google" && t.source_id
        ? `https://books.google.com/books?id=${t.source_id}`
        : "";

  return (
    <Modal title={isNew ? tr(meta.add) : tr("Edit")} onClose={onClose} wide>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0 sm:w-36">
          <Poster src={t.cover} title={t.title} className="aspect-[2/3] w-28 text-lg sm:w-36" />
          <button type="button" onClick={() => void lookup(false)} disabled={busy !== null || !t.title.trim()} className={`mt-2 w-full ${investingToolbarBtn}`}>
            {busy === "lookup" ? tr("Looking up…") : t.source_id ? tr("Refresh details") : tr("Find cover & details")}
          </button>
          {t.source_id ? (
            <button
              type="button"
              onClick={() => void lookup(true)}
              disabled={busy !== null}
              className="mt-1 block w-full text-center text-[11px] text-[#6f675b] underline decoration-black/15 underline-offset-2"
            >
              {tr("Wrong book? Re-match")}
            </button>
          ) : null}
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-1 block text-center text-[11px] text-[#6f675b] underline decoration-black/15 underline-offset-2">
              {tr("Open on {where} ↗", { where: t.source === "google" ? "Google Books" : "Open Library" })}
            </a>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <label className={fieldLabel}>
            {tr("Title")}
            <input value={t.title} onChange={(e) => set("title", e.target.value)} className={fieldInput} autoFocus={isNew && !t.title} />
          </label>
          {t.original_title && t.original_title !== t.title ? <p className="-mt-1 text-xs text-[#8f8676]">{tr("Catalogue title: {v}", { v: t.original_title })}</p> : null}
          <label className={fieldLabel}>
            {tr("Author")} <span className="font-normal text-[#a39a89]">{tr("comma-separated")}</span>
            <input value={text.authors} onChange={(e) => setField("authors", e.target.value)} className={fieldInput} />
          </label>
          {facts.length ? <p className="text-xs text-[#6f675b]">{facts.join(" · ")}</p> : null}
          {t.description ? <p className="line-clamp-4 text-xs leading-relaxed text-[#655d51]">{t.description}</p> : null}

          <div>
            <span className={fieldLabel}>{tr("Status")}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {READ_STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set("status", s.value)}
                  aria-pressed={t.status === s.value}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    t.status === s.value ? s.pill : "border-black/10 bg-white text-[#6f675b] hover:bg-[#faf8f2]"
                  }`}
                >
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {tr(s.label)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={fieldLabel}>{tr("Your score")}</span>
            <div className="mt-1 flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set("score", t.score === n ? null : n)}
                  aria-label={tr("{n} stars", { n })}
                  aria-pressed={t.score === n}
                  className={`text-2xl leading-none transition hover:scale-110 ${t.score != null && n <= t.score ? "text-[#eda100]" : "text-[#e2dccf]"}`}
                >
                  ★
                </button>
              ))}
              <span className="ml-2 text-xs text-[#6f675b]">{t.score != null ? `${t.score} / 5` : tr("not graded")}</span>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#2f2922]">
            <input type="checkbox" checked={t.recommended} onChange={(e) => set("recommended", e.target.checked)} className="h-4 w-4 accent-[#2a78d6]" />
            {tr("I recommend it")}
          </label>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className={fieldLabel}>
              {tr("Finished")}
              <input type="date" value={t.finish_date} onChange={(e) => set("finish_date", e.target.value)} className={fieldInput} />
            </label>
            <label className={fieldLabel}>
              {tr("Published")}
              <input value={text.year} onChange={(e) => setField("year", e.target.value)} inputMode="numeric" className={fieldInput} />
            </label>
            <label className={fieldLabel}>
              {tr("Pages")}
              <input value={text.pages} onChange={(e) => setField("pages", e.target.value)} inputMode="numeric" className={fieldInput} />
            </label>
          </div>
          {hasVolumes(t.kind) ? (
            <div className="grid grid-cols-2 gap-3">
              <label className={fieldLabel}>
                {tr("Volumes read")} <span className="font-normal text-[#a39a89]">{tr("up to volume")}</span>
                <input value={text.volumes_read} onChange={(e) => setField("volumes_read", e.target.value)} inputMode="numeric" className={fieldInput} />
              </label>
              <label className={fieldLabel}>
                {tr("Volumes out")}
                <input value={text.volumes_total} onChange={(e) => setField("volumes_total", e.target.value)} inputMode="numeric" className={fieldInput} />
              </label>
            </div>
          ) : null}
          <label className={fieldLabel}>
            {tr("Genres")} <span className="font-normal text-[#a39a89]">{tr("comma-separated")}</span>
            <input value={text.genres} onChange={(e) => setField("genres", e.target.value)} className={fieldInput} />
          </label>
          <label className={fieldLabel}>
            {tr("Notes")}
            <textarea
              value={t.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className={fieldInput}
              placeholder={tr("Favourite quote, who to give it to…")}
            />
          </label>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-rose-700">{tr(error)}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy !== null} className={investingPrimarySaveActive}>
          {busy === "save" ? tr("Saving…") : isNew ? tr("Add to library") : tr("Save")}
        </button>
        <button type="button" onClick={onClose} className={investingToolbarBtn}>
          {tr("Cancel")}
        </button>
        {onDelete ? (
          confirmDelete ? (
            <span className="ml-auto flex items-center gap-2 text-xs text-rose-800">
              {tr("Delete “{title}”?", { title: t.title })}
              <button type="button" onClick={() => void remove()} disabled={busy !== null} className="rounded-full bg-rose-700 px-3 py-1 font-medium text-white hover:bg-rose-800">
                {busy === "delete" ? tr("Deleting…") : tr("Delete")}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                {tr("Keep")}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto text-xs text-rose-700 underline decoration-rose-200 underline-offset-2">
              {tr("Delete")}
            </button>
          )
        ) : null}
      </div>
    </Modal>
  );
}
