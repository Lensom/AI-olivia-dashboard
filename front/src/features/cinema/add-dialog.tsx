"use client";

import { useEffect, useState } from "react";
import { cinemaKindMeta } from "@/features/cinema/nav";
import { errorText } from "@/features/cinema/title-dialog";
import {
  applyDetails,
  blankTitle,
  type CinemaDetails,
  type CinemaKind,
  type CinemaSearchResult,
  type CinemaTitle,
} from "@/features/cinema/types";
import { fieldInput, Modal, Poster } from "@/features/cinema/ui";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const EXAMPLES: Record<CinemaKind, string> = {
  film: "Inception",
  tv: "Breaking Bad",
  cartoon: "Coco",
  animated_series: "Arcane",
  anime: "Attack on Titan",
  show: "Top Gear",
};

type Props = {
  kind: CinemaKind;
  tmdbEnabled: boolean;
  existing: CinemaTitle[];
  /** A new title prefilled from TMDB (or typed by hand) to finish in the edit dialog. */
  onPick: (t: CinemaTitle) => void;
  /** The title is already in your list: open it instead. */
  onOpenExisting: (t: CinemaTitle) => void;
  onClose: () => void;
};

export function AddDialog({ kind, tmdbEnabled, existing, onPick, onOpenExisting, onClose }: Props) {
  const { token } = useAuth();
  const tr = useT();
  const meta = cinemaKindMeta(kind);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CinemaSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (!tmdbEnabled || query.length < 2) return;
    let cancelled = false;
    // Debounced: search once typing pauses.
    const timer = setTimeout(() => {
      setSearching(true);
      apiFetch<CinemaSearchResult[]>(`/cinema/search?kind=${kind}&q=${encodeURIComponent(query)}`, { token: token ?? undefined })
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setError(null);
          }
        })
        .catch((e) => !cancelled && setError(errorText(e, "Search failed.")))
        .finally(() => !cancelled && setSearching(false));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, kind, tmdbEnabled, token]);

  async function pick(r: CinemaSearchResult) {
    setPicking(r.tmdb_id);
    setError(null);
    try {
      const d = await apiFetch<CinemaDetails>(`/cinema/details?media=${r.tmdb_media}&tmdb_id=${r.tmdb_id}`, { token: token ?? undefined });
      onPick(applyDetails(blankTitle(kind), d, true));
    } catch (e) {
      setError(errorText(e, "Could not load details."));
      setPicking(null);
    }
  }

  const shown = q.trim().length >= 2 ? results : [];

  return (
    <Modal title={tr(meta.add)} onClose={onClose}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tmdbEnabled ? tr("Search TMDB — e.g. {example}", { example: EXAMPLES[kind] }) : tr("Title")}
        className={fieldInput}
        autoFocus
      />
      {!tmdbEnabled ? (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {tr("Search, posters and auto-filled genres and actors need a free TMDB key: create one at themoviedb.org → Settings → API, then add TMDB_API_KEY=… to back/.env and restart the backend. You can still add titles by hand.")}
        </p>
      ) : null}
      {error ? <p className="mt-2 text-xs text-rose-700">{tr(error)}</p> : null}

      <ul className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto">
        {shown.map((r) => {
          const dup = existing.find((t) => t.tmdb_id === r.tmdb_id && t.tmdb_media === r.tmdb_media);
          return (
            <li key={`${r.tmdb_media}-${r.tmdb_id}`}>
              <button
                type="button"
                disabled={picking !== null}
                onClick={() => (dup ? onOpenExisting(dup) : void pick(r))}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[#faf8f2] disabled:opacity-60"
              >
                <Poster src={r.poster} title={r.title} className="h-[72px] w-12 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[#1f1c17]">
                    {r.title} {r.year ? <span className="font-normal text-[#8f8676]">({r.year})</span> : null}
                  </span>
                  {r.original_title && r.original_title !== r.title ? (
                    <span className="block text-xs text-[#8f8676]">{r.original_title}</span>
                  ) : null}
                  <span className="mt-0.5 line-clamp-2 block text-xs text-[#6f675b]">{r.overview}</span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-[#8f8676]">
                  {dup ? <span className="block font-medium text-emerald-700">✓ {tr("In your list")}</span> : null}
                  {picking === r.tmdb_id ? tr("Loading…") : r.tmdb_rating ? `TMDB ${r.tmdb_rating}` : null}
                  {r.animation && (kind === "film" || kind === "tv") ? <span className="block">{tr("Animation")}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
        {tmdbEnabled && q.trim().length >= 2 && !searching && !shown.length && !error ? (
          <li className="px-2 py-3 text-sm text-[#8f8676]">{tr("Nothing found on TMDB.")}</li>
        ) : null}
        {searching && !shown.length ? <li className="px-2 py-3 text-sm text-[#8f8676]">{tr("Searching…")}</li> : null}
      </ul>

      <div className="mt-3 border-t border-black/5 pt-3">
        <button type="button" onClick={() => onPick(blankTitle(kind, q.trim()))} className={investingToolbarBtn}>
          {q.trim() ? tr("Add “{title}” by hand", { title: q.trim() }) : tr("Add by hand")}
        </button>
      </div>
    </Modal>
  );
}
