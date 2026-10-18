"use client";

import { useState } from "react";
import { cinemaKindMeta } from "@/features/cinema/nav";
import {
  applyDetails,
  isSeries,
  splitList,
  STATUSES,
  type CinemaDetails,
  type CinemaStatus,
  type CinemaTitle,
} from "@/features/cinema/types";
import { fieldInput, fieldLabel, Modal, Poster } from "@/features/cinema/ui";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { apiFetch, type ApiError } from "@/lib/api";
import { useAuth } from "@/state/auth-store";

const yearOrNull = (s: string) => {
  const n = Number(s.trim());
  return s.trim() && Number.isInteger(n) && n > 1850 && n < 2200 ? n : null;
};

export function errorText(e: unknown, fallback: string): string {
  const msg = (e as ApiError)?.message;
  if (!msg) return fallback;
  try {
    return (JSON.parse(msg) as { detail?: string }).detail ?? fallback;
  } catch {
    return msg;
  }
}

const seasonsOrNull = (s: string) => {
  const n = Number(s.trim());
  return s.trim() && Number.isInteger(n) && n > 0 && n < 100 ? n : null;
};

type Props = {
  initial: CinemaTitle;
  isNew: boolean;
  tmdbEnabled: boolean;
  onSave: (t: CinemaTitle) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
};

export function TitleDialog({ initial, isNew, tmdbEnabled, onSave, onDelete, onClose }: Props) {
  const { token } = useAuth();
  const [t, setT] = useState(initial);
  // Lists are edited as comma-separated text so commas can be typed freely.
  const [lists, setLists] = useState({
    genres: initial.genres.join(", "),
    studios: initial.studios.join(", "),
    actors: initial.actors.join(", "),
  });
  const [years, setYears] = useState({ year: initial.year?.toString() ?? "", view_year: initial.view_year?.toString() ?? "" });
  const [watchedSeasons, setWatchedSeasons] = useState(initial.watched_seasons?.toString() ?? "");
  const [busy, setBusy] = useState<null | "save" | "delete" | "tmdb">(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof CinemaTitle>(key: K, value: CinemaTitle[K]) => setT((p) => ({ ...p, [key]: value }));
  const current = (): CinemaTitle => ({
    ...t,
    title: t.title.trim(),
    genres: splitList(lists.genres),
    studios: splitList(lists.studios),
    actors: splitList(lists.actors),
    year: yearOrNull(years.year),
    view_year: yearOrNull(years.view_year),
    watched_seasons: seasonsOrNull(watchedSeasons),
  });

  /** Refresh the linked TMDB title, or (`rematch`) search again by name and year when the link is wrong. */
  async function refreshFromTmdb(rematch = false) {
    setBusy("tmdb");
    setError(null);
    try {
      const c = current();
      const d =
        c.tmdb_id && c.tmdb_media && !rematch
          ? await apiFetch<CinemaDetails>(`/cinema/details?media=${c.tmdb_media}&tmdb_id=${c.tmdb_id}`, { token: token ?? undefined })
          : await apiFetch<CinemaDetails | null>(
              `/cinema/match?kind=${c.kind}&title=${encodeURIComponent(c.title)}${c.year ? `&year=${c.year}` : ""}`,
              { token: token ?? undefined },
            );
      if (!d) {
        setError("No match on TMDB. Check the title or year, or add it from the search.");
        return;
      }
      // An explicit refresh takes TMDB's genres, actors and studios.
      const next = applyDetails(c, d, true);
      setT(next);
      setLists({ genres: next.genres.join(", "), studios: next.studios.join(", "), actors: next.actors.join(", ") });
      setYears((y) => ({ ...y, year: next.year?.toString() ?? "" }));
    } catch (e) {
      setError(errorText(e, "TMDB lookup failed."));
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

  const meta = cinemaKindMeta(t.kind);
  const facts = [
    t.directors.length ? `${t.tmdb_media === "tv" ? "Created by" : "Directed by"} ${t.directors.join(", ")}` : "",
    t.runtime ? `${t.runtime} min${t.tmdb_media === "tv" ? " / episode" : ""}` : "",
    t.seasons ? `${t.seasons} season${t.seasons > 1 ? "s" : ""}` : "",
    t.imdb_rating ? `IMDb ${t.imdb_rating.toFixed(1)}${t.imdb_votes ? ` (${t.imdb_votes.toLocaleString("en-US")} votes)` : ""}` : "",
    t.tmdb_rating ? `TMDB ${t.tmdb_rating}` : "",
  ].filter(Boolean);

  return (
    <Modal title={isNew ? `Add ${meta.singular}` : "Edit"} onClose={onClose} wide>
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="shrink-0 sm:w-36">
          <Poster src={t.poster} title={t.title} className="aspect-[2/3] w-28 text-lg sm:w-36" />
          {tmdbEnabled ? (
            <button type="button" onClick={() => void refreshFromTmdb()} disabled={busy !== null || !t.title.trim()} className={`mt-2 w-full ${investingToolbarBtn}`}>
              {busy === "tmdb" ? "Looking up…" : t.tmdb_id ? "Refresh from TMDB" : "Find on TMDB"}
            </button>
          ) : null}
          {t.tmdb_id && t.tmdb_media ? (
            <a
              href={`https://www.themoviedb.org/${t.tmdb_media}/${t.tmdb_id}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-center text-[11px] text-[#6f675b] underline decoration-black/15 underline-offset-2"
            >
              Open on TMDB ↗
            </a>
          ) : null}
          {tmdbEnabled && t.tmdb_id ? (
            <button
              type="button"
              onClick={() => void refreshFromTmdb(true)}
              disabled={busy !== null}
              className="mt-1 block w-full text-center text-[11px] text-[#6f675b] underline decoration-black/15 underline-offset-2"
              title="Search TMDB again by this title and release year"
            >
              Wrong title? Re-match
            </button>
          ) : null}
          {t.imdb_id ? (
            <a
              href={`https://www.imdb.com/title/${t.imdb_id}/`}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block text-center text-[11px] text-[#6f675b] underline decoration-black/15 underline-offset-2"
            >
              Open on IMDb ↗
            </a>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <label className={fieldLabel}>
            Title
            <input value={t.title} onChange={(e) => set("title", e.target.value)} className={fieldInput} autoFocus={isNew && !t.title} />
          </label>
          {t.original_title && t.original_title !== t.title ? (
            <p className="-mt-1 text-xs text-[#8f8676]">Original: {t.original_title}</p>
          ) : null}
          {facts.length ? <p className="text-xs text-[#6f675b]">{facts.join(" · ")}</p> : null}
          {t.overview ? <p className="line-clamp-4 text-xs leading-relaxed text-[#655d51]">{t.overview}</p> : null}

          <div>
            <span className={fieldLabel}>Status</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => set("status", s.value as CinemaStatus)}
                  aria-pressed={t.status === s.value}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                    t.status === s.value ? s.pill : "border-black/10 bg-white text-[#6f675b] hover:bg-[#faf8f2]"
                  }`}
                >
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className={fieldLabel}>Your score</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => set("score", t.score === n ? null : n)}
                  aria-pressed={t.score === n}
                  className={`h-7 w-7 rounded-md text-xs font-semibold tabular-nums transition ${
                    t.score != null && n <= t.score ? "bg-[#1f1c17] text-[#f8f4eb]" : "border border-black/10 bg-white text-[#6f675b] hover:bg-[#faf8f2]"
                  }`}
                >
                  {n}
                </button>
              ))}
              {t.score != null && !Number.isInteger(t.score) ? <span className="self-center text-xs text-[#6f675b]">{t.score}</span> : null}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-[#2f2922]">
            <input type="checkbox" checked={t.recommended} onChange={(e) => set("recommended", e.target.checked)} className="h-4 w-4 accent-[#2a78d6]" />
            I recommend it
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={fieldLabel}>
              Release year
              <input value={years.year} onChange={(e) => setYears((y) => ({ ...y, year: e.target.value }))} inputMode="numeric" className={fieldInput} />
            </label>
            <label className={fieldLabel}>
              Year you watched it
              <input value={years.view_year} onChange={(e) => setYears((y) => ({ ...y, view_year: e.target.value }))} inputMode="numeric" className={fieldInput} />
            </label>
          </div>
          {isSeries(t.kind) ? (
            <label className={fieldLabel}>
              Seasons watched <span className="font-normal text-[#a39a89]">up to season{t.seasons ? ` · ${t.seasons} released` : ""}</span>
              <span className="mt-1 flex items-center gap-2">
                <input value={watchedSeasons} onChange={(e) => setWatchedSeasons(e.target.value)} inputMode="numeric" className={`${fieldInput} mt-0 w-24`} />
                {t.seasons ? (
                  <button type="button" onClick={() => setWatchedSeasons(String(t.seasons))} className="text-xs text-[#6f675b] underline decoration-black/15 underline-offset-2">
                    All {t.seasons}
                  </button>
                ) : null}
              </span>
            </label>
          ) : null}
          <label className={fieldLabel}>
            Genres <span className="font-normal text-[#a39a89]">comma-separated</span>
            <input value={lists.genres} onChange={(e) => setLists((l) => ({ ...l, genres: e.target.value }))} className={fieldInput} />
          </label>
          <label className={fieldLabel}>
            Studio / distributor
            <input value={lists.studios} onChange={(e) => setLists((l) => ({ ...l, studios: e.target.value }))} className={fieldInput} />
          </label>
          <label className={fieldLabel}>
            Actors
            <textarea value={lists.actors} onChange={(e) => setLists((l) => ({ ...l, actors: e.target.value }))} rows={2} className={fieldInput} />
          </label>
          <label className={fieldLabel}>
            Notes
            <textarea value={t.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={fieldInput} placeholder="What stayed with you, who to watch it with…" />
          </label>
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={busy !== null} className={investingPrimarySaveActive}>
          {busy === "save" ? "Saving…" : isNew ? "Add to list" : "Save"}
        </button>
        <button type="button" onClick={onClose} className={investingToolbarBtn}>
          Cancel
        </button>
        {onDelete ? (
          confirmDelete ? (
            <span className="ml-auto flex items-center gap-2 text-xs text-rose-800">
              Delete “{t.title}”?
              <button type="button" onClick={() => void remove()} disabled={busy !== null} className="rounded-full bg-rose-700 px-3 py-1 font-medium text-white hover:bg-rose-800">
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto text-xs text-rose-700 underline decoration-rose-200 underline-offset-2">
              Delete
            </button>
          )
        ) : null}
      </div>
    </Modal>
  );
}
