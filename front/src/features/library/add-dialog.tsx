"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/features/cinema/title-dialog";
import { fieldInput, Modal, Poster } from "@/features/cinema/ui";
import { libraryKindMeta } from "@/features/library/nav";
import { applyBookDetails, blankItem, type LibraryDetails, type LibraryItem, type LibraryKind } from "@/features/library/types";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const EXAMPLES: Record<LibraryKind, string> = {
  book: "Atomic Habits",
  comic: "Watchmen",
  manga: "Berserk",
  magazine: "National Geographic",
};

type Props = {
  kind: LibraryKind;
  googleEnabled: boolean;
  existing: LibraryItem[];
  onPick: (t: LibraryItem) => void;
  onOpenExisting: (t: LibraryItem) => void;
  onClose: () => void;
};

export function AddBookDialog({ kind, googleEnabled, existing, onPick, onOpenExisting, onClose }: Props) {
  const { token } = useAuth();
  const tr = useT();
  const meta = libraryKindMeta(kind);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<LibraryDetails[]>([]);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let cancelled = false;
    // Debounced: search once typing pauses.
    const timer = setTimeout(() => {
      setSearching(true);
      apiFetch<LibraryDetails[]>(`/library/search?kind=${kind}&q=${encodeURIComponent(query)}`, { token: token ?? undefined })
        .then((r) => {
          if (!cancelled) {
            setResults(r);
            setError(null);
          }
        })
        .catch((e) => !cancelled && setError(errorText(e, "Search failed.")))
        .finally(() => !cancelled && setSearching(false));
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, kind, token]);

  async function pick(r: LibraryDetails) {
    setPicking(r.source_id);
    setError(null);
    try {
      // Search results lack the description: fetch the full entry.
      const d = await apiFetch<LibraryDetails>(
        `/library/details?kind=${kind}&source=${r.source}&source_id=${encodeURIComponent(r.source_id)}`,
        { token: token ?? undefined },
      ).catch(() => r);
      onPick(applyBookDetails(blankItem(kind), d, true));
    } catch (e) {
      setError(errorText(e, "Could not load details."));
      setPicking(null);
    }
  }

  const shown = q.trim().length >= 2 ? results : [];

  return (
    <Modal title={tr(meta.add)} onClose={onClose}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search by title or author — e.g. {example}", { example: EXAMPLES[kind] })} className={fieldInput} autoFocus />
      <p className="mt-1.5 text-[11px] text-[#8f8676]">
        {googleEnabled
          ? tr("Searching Google Books and Open Library.")
          : tr("Searching Open Library — it rarely lists Ukrainian editions, so try the English title.")}
      </p>
      {error ? <p className="mt-2 text-xs text-rose-700">{tr(error)}</p> : null}

      <ul className="mt-3 max-h-[55vh] space-y-1 overflow-y-auto">
        {shown.map((r) => {
          const dup = existing.find((t) => t.source_id && t.source_id === r.source_id);
          return (
            <li key={`${r.source}-${r.source_id}`}>
              <button
                type="button"
                disabled={picking !== null}
                onClick={() => (dup ? onOpenExisting(dup) : void pick(r))}
                className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-[#faf8f2] disabled:opacity-60"
              >
                <Poster src={r.cover} title={r.title} className="h-[72px] w-12 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[#1f1c17]">
                    {r.title} {r.year ? <span className="font-normal text-[#8f8676]">({r.year})</span> : null}
                  </span>
                  <span className="block text-xs text-[#6f675b]">{r.authors.join(", ")}</span>
                  <span className="mt-0.5 block text-[11px] text-[#8f8676]">
                    {[r.pages ? tr("{n} pages", { n: r.pages }) : "", r.genres.slice(0, 2).join(", "), r.language.toUpperCase()].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 text-right text-[11px] text-[#8f8676]">
                  {dup ? <span className="block font-medium text-emerald-700">✓ {tr("In your library")}</span> : null}
                  {picking === r.source_id ? tr("Loading…") : r.source_rating ? `★ ${r.source_rating.toFixed(1)}` : null}
                </span>
              </button>
            </li>
          );
        })}
        {q.trim().length >= 2 && !searching && !shown.length && !error ? <li className="px-2 py-3 text-sm text-[#8f8676]">{tr("Nothing found. Try the English title or the author.")}</li> : null}
        {searching && !shown.length ? <li className="px-2 py-3 text-sm text-[#8f8676]">{tr("Searching…")}</li> : null}
      </ul>

      <div className="mt-3 border-t border-black/5 pt-3">
        <button type="button" onClick={() => onPick(blankItem(kind, q.trim()))} className={investingToolbarBtn}>
          {q.trim() ? tr("Add “{title}” by hand", { title: q.trim() }) : tr("Add by hand")}
        </button>
      </div>
    </Modal>
  );
}
