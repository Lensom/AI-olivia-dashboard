"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FranchiseBadge, tierOf, type FranchiseTier } from "@/features/cinema/franchises";
import { errorText } from "@/features/cinema/title-dialog";
import { Poster } from "@/features/cinema/ui";
import { applyBookDetails, blankItem, type LibraryDetails, type LibraryItem, type LibrarySeries, type LibrarySeriesPart } from "@/features/library/types";
import { apiFetch } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useLibrary } from "@/state/library-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

export type SeriesBook = LibrarySeriesPart & { mine: LibraryItem | null };

export type BookSeries = {
  id: string;
  name: string;
  author: string;
  poster: string;
  parts: SeriesBook[];
  total: number;
  read: number;
  /** Books not read yet. */
  left: number;
  tier: FranchiseTier;
  /** Your average score over the books you've read. */
  avgScore: number | null;
  /** Year you finished the last book of a complete series (when known). */
  completedYear: number | null;
  /** The next unread book, in reading order. */
  nextPart: SeriesBook | null;
};

const norm = (s: string) => s.toLowerCase().replace(/ґ/g, "г").replace(/[^\p{L}\p{N}]+/gu, "");

/** Wikidata series of the books in your library, with your progress through each. */
export function useBookSeries(): { series: BookSeries[]; isLoading: boolean } {
  const { token } = useAuth();
  const [lang] = useLang();
  const { items, isSyncingSeries } = useLibrary();
  const [loaded, setLoaded] = useState<{ key: string; list: LibrarySeries[] } | null>(null);

  const idsKey = useMemo(() => [...new Set(items.map((x) => x.series_id).filter(Boolean))].sort().join(","), [items]);
  const key = `${lang}:${idsKey}`;

  useEffect(() => {
    if (!token || !idsKey) return;
    let alive = true;
    apiFetch<LibrarySeries[]>(`/library/series?lang=${lang}`, { token, method: "POST", body: JSON.stringify(idsKey.split(",")) })
      .then((list) => alive && setLoaded({ key, list }))
      .catch(() => alive && setLoaded({ key, list: [] }));
    return () => {
      alive = false;
    };
  }, [token, idsKey, lang, key]);

  const series = useMemo(() => {
    const books = items.filter((x) => x.kind !== "magazine");
    // A book is yours by its Wikidata entity, or by title for books Wikidata couldn't place.
    const find = (p: LibrarySeriesPart) =>
      books.find((x) => x.wikidata_id && x.wikidata_id === p.wikidata_id) ??
      books.find((x) => {
        const mine = [x.title, x.original_title].filter(Boolean).map(norm);
        return [p.title, p.original_title].filter(Boolean).some((n) => mine.includes(norm(n)));
      }) ??
      null;
    return (loaded?.list ?? [])
      .map((s): BookSeries => {
        const parts = s.parts.map((p) => ({ ...p, mine: find(p) }));
        const done = parts.filter((p) => p.mine?.status === "read");
        const scores = done.map((p) => p.mine!.score).filter((n): n is number => n != null);
        const tier = tierOf(done.length, parts.length);
        const years = done.map((p) => Number(p.mine!.finish_date.slice(0, 4))).filter((y) => y > 1900);
        return {
          id: s.id,
          name: s.name,
          author: parts.find((p) => p.author)?.author ?? "",
          poster: parts.find((p) => p.mine?.cover)?.mine?.cover || parts.find((p) => p.cover)?.cover || "",
          parts,
          total: parts.length,
          read: done.length,
          left: parts.length - done.length,
          tier,
          avgScore: scores.length ? scores.reduce((a, n) => a + n, 0) / scores.length : null,
          completedYear: tier === "gold" && years.length ? Math.max(...years) : null,
          nextPart: parts.find((p) => p.mine?.status !== "read") ?? null,
        };
      })
      .filter((s) => s.parts.some((p) => p.mine));
  }, [loaded, items]);

  return { series, isLoading: isSyncingSeries || (idsKey !== "" && loaded?.key !== key) };
}

/** Closest to complete first (fewest books left), then the biggest. */
export const bySeriesProgress = (a: BookSeries, b: BookSeries) => a.left - b.left || b.read / b.total - a.read / a.total || b.total - a.total;

export function SeriesBadge({ s, size = 84 }: { s: BookSeries; size?: number }) {
  return <FranchiseBadge f={{ name: s.name, poster: s.poster, tier: s.tier, watched: s.read, released: s.total }} size={size} />;
}

/** Add a book of a series to Want to read, with the catalogue's cover and pages when Open Library has it. */
export function usePlanBook() {
  const t = useT();
  const { token } = useAuth();
  const { update } = useLibrary();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function plan(s: BookSeries, p: SeriesBook) {
    setAdding(p.wikidata_id);
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    try {
      let details: LibraryDetails | null = null;
      if (p.ol_id) {
        details = await apiFetch<LibraryDetails>(`/library/details?source=openlibrary&source_id=${encodeURIComponent(p.ol_id)}&kind=book`, {
          token: token ?? undefined,
        }).catch(() => null);
      }
      const base: LibraryItem = {
        ...blankItem("book", p.title),
        status: "planned",
        finish_date: "",
        authors: p.author ? [p.author] : [],
        year: p.year,
        cover: p.cover,
        original_title: p.original_title && p.original_title !== p.title ? p.original_title : "",
      };
      const item = {
        ...(details ? applyBookDetails(base, details, false) : base),
        wikidata_id: p.wikidata_id,
        series_id: s.id,
        series_name: s.name,
        wikidata_synced: today,
      };
      await update((list) => [item, ...list]);
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
    } finally {
      setAdding(null);
    }
  }
  return { plan, adding, error };
}

/** The books of a series as a sticker album: read in colour, the rest greyed with "+ Want to read". */
export function BooksStrip({ s, plan, adding, size = 64 }: { s: BookSeries; plan: (s: BookSeries, p: SeriesBook) => void; adding: string | null; size?: number }) {
  const t = useT();
  return (
    <ul className="flex gap-2 overflow-x-auto pb-1">
      {s.parts.map((p) => {
        const status = p.mine?.status;
        return (
          <li key={p.wikidata_id} className="shrink-0" style={{ width: size }}>
            <span className="relative block">
              <Poster src={p.mine?.cover || p.cover} title={p.title} className={`aspect-[2/3] w-full ${status === "read" ? "" : "opacity-40 grayscale"}`} />
              {status === "read" ? <span className="absolute right-1 top-1 rounded bg-emerald-600 px-1 text-[10px] font-semibold text-white">✓</span> : null}
              {p.index ? <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[10px] font-semibold text-white">{p.index}</span> : null}
            </span>
            <span className="mt-1 block truncate text-[11px] text-[#3b352d]" title={p.title}>
              {p.title}
            </span>
            <span className="block text-[10px] text-[#8f8676]">
              {status === "read"
                ? p.mine?.score != null
                  ? `★ ${p.mine.score}`
                  : (p.year ?? "")
                : status === "planned"
                  ? t("Want to read")
                  : status === "reading"
                    ? t("Reading")
                    : status === "dropped"
                      ? t("Dropped")
                      : (p.year ?? "")}
            </span>
            {!p.mine ? (
              <button
                type="button"
                onClick={() => plan(s, p)}
                disabled={adding !== null}
                className="mt-0.5 rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-medium text-[#3b352d] hover:bg-[#faf8f2] disabled:opacity-50"
                title={t("Add to Want to read")}
              >
                {adding === p.wikidata_id ? "…" : `+ ${t("Want")}`}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Overview card: how many series are complete and the ones closest to it, linking to the Series page. */
export function LibrarySeriesCard() {
  const t = useT();
  const { series } = useBookSeries();
  const { plan, adding, error } = usePlanBook();
  if (!series.length) return null;
  const done = series.filter((s) => s.tier === "gold").length;
  const closest = series.filter((s) => s.tier !== "gold").sort(bySeriesProgress).slice(0, 3);

  return (
    <section className={card} aria-labelledby="series-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="series-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("Book series")}
          </h2>
          <p className="text-xs text-[#6f675b]">{t("{done} of {n} complete · closest to finishing:", { done, n: series.length })}</p>
        </div>
        <Link href="/library/series" className="text-xs text-[#6f675b] hover:text-[#1f1c17]">
          {t("All series →")}
        </Link>
      </div>
      {error ? <p className="mb-2 text-xs text-rose-700">{error}</p> : null}
      {closest.length ? (
        <ul className="space-y-4">
          {closest.map((s) => (
            <li key={s.id} className="flex gap-4">
              <SeriesBadge s={s} size={64} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-[#1f1c17]">{s.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[#6f675b]">{t("{r} / {n} read", { r: s.read, n: s.total })}</span>
                </p>
                <div className="mt-1.5">
                  <BooksStrip s={s} plan={(x, p) => void plan(x, p)} adding={adding} size={48} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs font-medium text-amber-700">★ {t("Every series you've started is complete.")}</p>
      )}
    </section>
  );
}
