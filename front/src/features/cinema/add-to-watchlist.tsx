"use client";

import { useState } from "react";
import { titleFromTmdb } from "@/features/cinema/add-from-tmdb";
import { errorText } from "@/features/cinema/title-dialog";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useCinema } from "@/state/cinema-store";

/** A film you don't have yet, onto your watchlist in one click (details from TMDB); says so once it's there. */
export function AddToWatchlist({ tmdbId, animation, className = "" }: { tmdbId: number; animation: boolean; className?: string }) {
  const t = useT();
  const { token } = useAuth();
  const { items, update } = useCinema();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mine = items.find((x) => x.tmdb_id === tmdbId && x.tmdb_media === "movie");

  if (mine) {
    return <span className={`shrink-0 text-[11px] text-emerald-700 ${className}`}>{mine.status === "watched" ? t("Watched") : t("On your watchlist")}</span>;
  }

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const title = await titleFromTmdb(token, "movie", tmdbId, animation ? "cartoon" : "film", "planned");
      await update((list) => (list.some((x) => x.tmdb_id === tmdbId && x.tmdb_media === "movie") ? list : [title, ...list]));
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`flex shrink-0 flex-col items-end ${className}`}>
      <button type="button" onClick={() => void add()} disabled={busy} className={investingToolbarBtn}>
        {busy ? t("Adding…") : t("Add to watchlist")}
      </button>
      {error ? <span className="mt-0.5 text-[11px] text-rose-700">{error}</span> : null}
    </span>
  );
}
