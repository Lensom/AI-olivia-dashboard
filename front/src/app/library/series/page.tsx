"use client";

import { useMemo, useState } from "react";
import { GOALS, TIERS, type FranchiseTier } from "@/features/cinema/franchises";
import { BooksStrip, bySeriesProgress, SeriesBadge, useBookSeries, usePlanBook, type BookSeries } from "@/features/library/series";
import { useT } from "@/lib/i18n";
import { useLibrary } from "@/state/library-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

type Filter = "all" | "gold" | "progress";
type Sort = "progress" | "size" | "score" | "name";

const FILTERS: { value: Filter; label: string; match: (s: BookSeries) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "gold", label: "Complete", match: (s) => s.tier === "gold" },
  { value: "progress", label: "In progress", match: (s) => s.tier !== "gold" },
];

const SORTS: { value: Sort; label: string; cmp: (a: BookSeries, b: BookSeries) => number }[] = [
  { value: "progress", label: "Closest to complete", cmp: bySeriesProgress },
  { value: "size", label: "Most books", cmp: (a, b) => b.total - a.total || bySeriesProgress(a, b) },
  { value: "score", label: "Your score", cmp: (a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1) || bySeriesProgress(a, b) },
  { value: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) },
];

// A series shows up once you've added one of its books, so "not started" means added but none read.
const TIER_ORDER: FranchiseTier[] = ["gold", "silver", "bronze", "locked"];

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"
  }`;

export default function LibrarySeriesPage() {
  const t = useT();
  const { isLoaded, loadError } = useLibrary();
  const { series, isLoading } = useBookSeries();
  const { plan, adding, error } = usePlanBook();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("progress");

  const stats = useMemo(() => {
    const done = series.filter((s) => s.tier === "gold").length;
    const books = series.reduce((n, s) => n + s.total, 0);
    const read = series.reduce((n, s) => n + s.read, 0);
    const goal = GOALS.find((g) => g > done) ?? null;
    const tiers = Object.fromEntries(TIER_ORDER.map((k) => [k, series.filter((s) => s.tier === k).length])) as Record<FranchiseTier, number>;
    const closest = series.filter((s) => s.tier !== "gold" && s.read > 0).sort(bySeriesProgress)[0] ?? null;
    return { done, books, read, goal, tiers, closest };
  }, [series]);

  const shown = useMemo(() => {
    const match = FILTERS.find((x) => x.value === filter)!.match;
    const cmp = SORTS.find((x) => x.value === sort)!.cmp;
    // Complete ones sit at the end when sorting by progress, like a trophy shelf after the to-dos.
    const list = series.filter(match);
    return sort === "progress" ? [...list].sort((a, b) => Number(a.tier === "gold") - Number(b.tier === "gold") || cmp(a, b)) : [...list].sort(cmp);
  }, [series, filter, sort]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded || (isLoading && !series.length)) return <p className="text-sm text-[#8f8676]">{t("Looking up series on Wikidata…")}</p>;
  if (!series.length) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center">
        <p className="text-sm font-medium text-[#1f1c17]">{t("No series yet")}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-[#6f675b]">
          {t("Series come from Wikidata. Books matched with “Fill covers & details” are found best; Harry Potter, Poirot or Sherlock Holmes appear here once one of their books is in your library.")}
        </p>
      </div>
    );
  }

  const goalPrev = stats.goal ? ([0, ...GOALS].filter((g) => g < stats.goal!).pop() ?? 0) : 0;

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={`${card} border-amber-200 bg-gradient-to-br from-amber-50 to-white`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">{t("Complete")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[#1f1c17]">
            {stats.done} <span className="text-base font-normal text-[#8f8676]">/ {series.length}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TIER_ORDER.filter((k) => stats.tiers[k]).map((k) => (
              <span key={k} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TIERS[k].badge}`}>
                {t(TIERS[k].label)} · {stats.tiers[k]}
              </span>
            ))}
          </div>
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Next goal")}</p>
          {stats.goal ? (
            <>
              <p className="mt-1 text-base font-semibold text-[#1f1c17]">{t("Complete {n} series", { n: stats.goal })}</p>
              <span className="mt-2 block h-2 rounded-full bg-[#f3efe5]">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
                  style={{ width: `${((stats.done - goalPrev) / (stats.goal - goalPrev)) * 100}%` }}
                />
              </span>
              <p className="mt-1.5 text-xs text-[#6f675b]">
                {stats.closest
                  ? t("{n} to go. Closest: {name}, {left} books left.", { n: stats.goal - stats.done, name: stats.closest.name, left: stats.closest.left })
                  : t("{n} to go.", { n: stats.goal - stats.done })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-base font-semibold text-amber-700">★ {t("Every goal unlocked")}</p>
          )}
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Series books read")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[#1f1c17]">
            {stats.read} <span className="text-base font-normal text-[#8f8676]">/ {stats.books}</span>
          </p>
          <span className="mt-2 block h-2 rounded-full bg-[#f3efe5]">
            <span className="block h-full rounded-full bg-[#2a78d6]" style={{ width: `${stats.books ? (stats.read / stats.books) * 100 : 0}%` }} />
          </span>
          <p className="mt-1.5 text-xs text-[#6f675b]">{t("{n} books left to collect", { n: stats.books - stats.read })}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <button key={x.value} type="button" onClick={() => setFilter(x.value)} className={chip(filter === x.value)} aria-pressed={filter === x.value}>
            {t(x.label)} {series.filter(x.match).length}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="ml-auto rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]"
          aria-label={t("Sort by")}
        >
          {SORTS.map((x) => (
            <option key={x.value} value={x.value}>
              {t("Sort: {v}", { v: t(x.label) })}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{error}</p> : null}

      {shown.length ? (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((s) => {
            const tier = TIERS[s.tier];
            return (
              <li key={s.id} className={`rounded-2xl border p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] ${tier.card}`}>
                <div className="flex gap-4">
                  <SeriesBadge s={s} />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold leading-snug text-[#1f1c17]">{s.name}</p>
                    {s.author ? <p className="text-xs text-[#8f8676]">{s.author}</p> : null}
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#6f675b]">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tier.badge}`}>{t(tier.label)}</span>
                      <span className="tabular-nums">{t("{r} / {n} read", { r: s.read, n: s.total })}</span>
                      {s.avgScore != null ? <span>· {t("your avg ★ {v}", { v: s.avgScore.toFixed(1) })}</span> : null}
                    </p>
                    <p className="mt-1 text-[11px] text-[#8f8676]">
                      {s.tier === "gold"
                        ? s.completedYear
                          ? t("Completed in {year}", { year: s.completedYear })
                          : t("Every book read")
                        : s.left === 1
                          ? t("One book to go!")
                          : t("{n} books to go", { n: s.left })}
                      {s.nextPart && s.tier !== "gold" ? ` · ${t("next: {title}", { title: s.nextPart.title })}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <BooksStrip s={s} plan={(x, p) => void plan(x, p)} adding={adding} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-[#8f8676]">{t("Nothing matches these filters.")}</p>
      )}
      <p className="text-[11px] text-[#8f8676]">{t("Series and their books come from Wikidata, so some lists may be incomplete.")}</p>
    </div>
  );
}
