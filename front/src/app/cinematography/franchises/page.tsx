"use client";

import { useMemo, useState } from "react";
import {
  byProgress,
  FranchiseBadge,
  GOALS,
  PartsStrip,
  TIERS,
  useFranchises,
  usePlanPart,
  type Franchise,
  type FranchiseTier,
} from "@/features/cinema/franchises";
import { useLocale, useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

type Filter = "all" | "gold" | "progress" | "locked";
type Sort = "progress" | "size" | "score" | "name";

const FILTERS: { value: Filter; label: string; match: (f: Franchise) => boolean }[] = [
  { value: "all", label: "All", match: () => true },
  { value: "gold", label: "Complete", match: (f) => f.tier === "gold" },
  { value: "progress", label: "In progress", match: (f) => f.tier === "bronze" || f.tier === "silver" },
  { value: "locked", label: "Not started", match: (f) => f.tier === "locked" },
];

const SORTS: { value: Sort; label: string; cmp: (a: Franchise, b: Franchise) => number }[] = [
  { value: "progress", label: "Closest to complete", cmp: byProgress },
  { value: "size", label: "Most films", cmp: (a, b) => b.released - a.released || byProgress(a, b) },
  { value: "score", label: "Your score", cmp: (a, b) => (b.avgScore ?? -1) - (a.avgScore ?? -1) || byProgress(a, b) },
  { value: "name", label: "Name", cmp: (a, b) => a.name.localeCompare(b.name) },
];

const TIER_ORDER: FranchiseTier[] = ["gold", "silver", "bronze", "locked"];

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"
  }`;

export default function CinemaFranchisesPage() {
  const t = useT();
  const locale = useLocale();
  const { isLoaded, loadError, tmdbEnabled } = useCinema();
  const { franchises, isLoading } = useFranchises();
  const { plan, adding, error } = usePlanPart();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("progress");

  const stats = useMemo(() => {
    const done = franchises.filter((f) => f.tier === "gold").length;
    const films = franchises.reduce((s, f) => s + f.released, 0);
    const watched = franchises.reduce((s, f) => s + f.watched, 0);
    const goal = GOALS.find((g) => g > done) ?? null;
    const tiers = Object.fromEntries(TIER_ORDER.map((k) => [k, franchises.filter((f) => f.tier === k).length])) as Record<FranchiseTier, number>;
    const closest = franchises.filter((f) => f.tier !== "gold" && f.tier !== "locked").sort(byProgress)[0] ?? null;
    return { done, films, watched, goal, tiers, closest };
  }, [franchises]);

  const shown = useMemo(() => {
    const match = FILTERS.find((x) => x.value === filter)!.match;
    const cmp = SORTS.find((x) => x.value === sort)!.cmp;
    // Complete ones sit at the end when sorting by progress, like a trophy shelf after the to-dos.
    const list = franchises.filter(match);
    return sort === "progress" ? [...list].sort((a, b) => Number(a.tier === "gold") - Number(b.tier === "gold") || cmp(a, b)) : [...list].sort(cmp);
  }, [franchises, filter, sort]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded || isLoading) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;
  if (!franchises.length) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center">
        <p className="text-sm font-medium text-[#1f1c17]">{t("No franchises yet")}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-[#6f675b]">
          {tmdbEnabled
            ? t("Franchises come from TMDB collections. Add films from the TMDB search (or use Fill from TMDB), and series like Harry Potter or Toy Story appear here.")
            : t("Franchises come from TMDB collections: add TMDB_API_KEY to back/.env first.")}
        </p>
      </div>
    );
  }

  const goalPrev = stats.goal ? ([0, ...GOALS].filter((g) => g < stats.goal!).pop() ?? 0) : 0;

  return (
    <div className="space-y-5">
      {/* Trophy cabinet */}
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={`${card} border-amber-200 bg-gradient-to-br from-amber-50 to-white`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">{t("Complete")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[#1f1c17]">
            {stats.done} <span className="text-base font-normal text-[#8f8676]">/ {franchises.length}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TIER_ORDER.map((k) => (
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
              <p className="mt-1 text-base font-semibold text-[#1f1c17]">{t("Complete {n} franchises", { n: stats.goal })}</p>
              <span className="mt-2 block h-2 rounded-full bg-[#f3efe5]">
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
                  style={{ width: `${((stats.done - goalPrev) / (stats.goal - goalPrev)) * 100}%` }}
                />
              </span>
              <p className="mt-1.5 text-xs text-[#6f675b]">
                {stats.closest
                  ? t("{n} to go. Closest: {name}, {left} left.", { n: stats.goal - stats.done, name: stats.closest.name, left: stats.closest.left })
                  : t("{n} to go.", { n: stats.goal - stats.done })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-base font-semibold text-amber-700">★ {t("Every goal unlocked")}</p>
          )}
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Franchise films watched")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[#1f1c17]">
            {stats.watched} <span className="text-base font-normal text-[#8f8676]">/ {stats.films}</span>
          </p>
          <span className="mt-2 block h-2 rounded-full bg-[#f3efe5]">
            <span className="block h-full rounded-full bg-[#2a78d6]" style={{ width: `${stats.films ? (stats.watched / stats.films) * 100 : 0}%` }} />
          </span>
          <p className="mt-1.5 text-xs text-[#6f675b]">{t("{n} films left to collect", { n: stats.films - stats.watched })}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((x) => (
          <button key={x.value} type="button" onClick={() => setFilter(x.value)} className={chip(filter === x.value)} aria-pressed={filter === x.value}>
            {t(x.label)} {franchises.filter(x.match).length}
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
          {shown.map((f) => {
            const tier = TIERS[f.tier];
            return (
              <li key={f.id} className={`rounded-2xl border p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] ${tier.card}`}>
                <div className="flex gap-4">
                  <FranchiseBadge f={f} />
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold leading-snug text-[#1f1c17]">{f.name}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-[#6f675b]">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tier.badge}`}>{t(tier.label)}</span>
                      <span className="tabular-nums">{t("{w} / {n} watched", { w: f.watched, n: f.released })}</span>
                      {f.avgScore != null ? <span>· {t("your avg {v}", { v: f.avgScore.toFixed(1) })}</span> : null}
                    </p>
                    <p className="mt-1 text-[11px] text-[#8f8676]">
                      {f.tier === "gold"
                        ? f.completedYear
                          ? t("Completed in {year}", { year: f.completedYear })
                          : t("Every released film watched")
                        : f.left === 1
                          ? t("One film to go!")
                          : t("{n} films to go", { n: f.left })}
                      {f.nextPart
                        ? ` · ${t("next: {title}", { title: f.nextPart.title })}${
                            f.nextPart.release_date
                              ? `, ${new Date(f.nextPart.release_date).toLocaleDateString(locale, { month: "short", year: "numeric" })}`
                              : ""
                          }`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-3">
                  <PartsStrip f={f} plan={(p) => void plan(p)} adding={adding} />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-[#8f8676]">{t("Nothing matches these filters.")}</p>
      )}
    </div>
  );
}
