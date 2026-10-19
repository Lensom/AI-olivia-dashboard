"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CINEMA_KINDS, cinemaKindMeta } from "@/features/cinema/nav";
import type { CinemaTitle } from "@/features/cinema/types";
import { Poster, ScoreBadge } from "@/features/cinema/ui";
import { HBars, VBars } from "@/features/shared/bar-charts";
import { useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

function avgScore(list: CinemaTitle[]): number | null {
  const s = list.filter((t) => t.score != null);
  return s.length ? s.reduce((a, t) => a + (t.score ?? 0), 0) / s.length : null;
}

function countBy(list: CinemaTitle[], keys: (t: CinemaTitle) => (string | number)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) for (const k of keys(t)) m.set(String(k), (m.get(String(k)) ?? 0) + 1);
  return m;
}

function PosterRow({ list, empty }: { list: CinemaTitle[]; empty: string }) {
  const tr = useT();
  if (!list.length) return <p className="text-xs text-[#8f8676]">{tr(empty)}</p>;
  return (
    <ul className="flex gap-3 overflow-x-auto pb-1">
      {list.map((t) => (
        <li key={t.id} className="w-24 shrink-0">
          <Link href={`/cinematography/${cinemaKindMeta(t.kind).slug}`} className="group block">
            <span className="relative block">
              <Poster src={t.poster} title={t.title} className="aspect-[2/3] w-24 text-lg transition group-hover:-translate-y-0.5" />
              <span className="absolute left-1 top-1"><ScoreBadge score={t.score} /></span>
            </span>
            <span className="mt-1 block truncate text-xs font-medium text-[#1f1c17]">{t.title}</span>
            <span className="block truncate text-[11px] text-[#8f8676]">{[tr(cinemaKindMeta(t.kind).label), t.year].filter(Boolean).join(" · ")}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function CinematographyOverview() {
  const { items, isLoaded, loadError } = useCinema();
  const tr = useT();
  const [thisYear] = useState(() => new Date().getFullYear());

  const s = useMemo(() => {
    const watched = items.filter((t) => t.status === "watched");
    const years = items.map((t) => t.view_year).filter((y): y is number => y != null);
    const yearRows: [string, number][] = [];
    if (years.length) {
      const counts = countBy(items, (t) => (t.view_year != null && t.status !== "planned" ? [t.view_year] : []));
      for (let y = Math.min(...years); y <= Math.max(...years); y++) yearRows.push([String(y), counts.get(String(y)) ?? 0]);
    }
    const scoreCounts = countBy(items, (t) => (t.score != null ? [Math.round(t.score)] : []));
    const genreRows = [...countBy(items, (t) => t.genres).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const actorRows = [...countBy(watched, (t) => t.actors).entries()].filter((r) => r[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 8);
    // You vs IMDb on the titles that have both.
    const both = items.filter((t) => t.score != null && t.imdb_rating != null);
    const vsImdb = both.length
      ? { n: both.length, mine: both.reduce((a, t) => a + (t.score ?? 0), 0) / both.length, imdb: both.reduce((a, t) => a + (t.imdb_rating ?? 0), 0) / both.length }
      : null;
    const minutes = watched.reduce((a, t) => a + (t.tmdb_media === "movie" && t.runtime ? t.runtime : 0), 0);
    return {
      watched,
      avg: avgScore(items),
      recommended: [...items.filter((t) => t.recommended)].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      watching: items.filter((t) => t.status === "watching"),
      planned: items.filter((t) => t.status === "planned").length,
      thisYear: items.filter((t) => t.view_year === thisYear && t.status !== "planned").length,
      yearRows,
      scoreRows: Array.from({ length: 10 }, (_, i) => [String(i + 1), scoreCounts.get(String(i + 1)) ?? 0] as [string, number]),
      scored: [...scoreCounts.values()].reduce((a, n) => a + n, 0),
      genreRows,
      actorRows,
      hours: Math.round(minutes / 60),
      vsImdb,
    };
  }, [items, thisYear]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{tr(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{tr("Loading…")}</p>;

  const stats = [
    { label: tr("Titles"), value: String(items.length), sub: tr("{watched} watched · {planned} planned", { watched: s.watched.length, planned: s.planned }) },
    {
      label: tr("Average score"),
      value: s.avg != null ? s.avg.toFixed(1) : "—",
      sub: s.vsImdb ? tr("IMDb {v} on the same {n} titles", { v: s.vsImdb.imdb.toFixed(1), n: s.vsImdb.n }) : tr("your grades, out of 10"),
    },
    { label: tr("Recommended"), value: String(s.recommended.length), sub: tr("ticked as worth watching") },
    { label: tr("Watched in {year}", { year: thisYear }), value: String(s.thisYear), sub: s.hours ? tr("~{n} h of films in total", { n: s.hours }) : tr("by year watched") },
  ];

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((x) => (
          <div key={x.label} className={card}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{x.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">{x.value}</p>
            <p className="mt-0.5 text-xs text-[#6f675b]">{x.sub}</p>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CINEMA_KINDS.map((k) => {
          const list = items.filter((t) => t.kind === k.kind);
          const avg = avgScore(list);
          const posters = [...list].filter((t) => t.poster).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4);
          return (
            <Link key={k.kind} href={`/cinematography/${k.slug}`} className={`${card} group block transition hover:-translate-y-0.5 hover:bg-white`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-[#1f1c17]">{tr(k.label)}</h2>
                <span className="text-xs text-[#8f8676] group-hover:text-[#1f1c17]">{tr("Open →")}</span>
              </div>
              <p className="mt-0.5 text-xs text-[#6f675b]">
                {list.length
                  ? tr("{n} titles", { n: list.length }) + (avg != null ? ` · ${tr("avg {v}", { v: avg.toFixed(1) })}` : "")
                  : tr(k.description)}
              </p>
              <div className="mt-3 flex h-[72px] gap-1.5">
                {posters.length ? (
                  posters.map((t) => <Poster key={t.id} src={t.poster} title={t.title} className="h-[72px] w-12" />)
                ) : (
                  <span className="self-center text-xs text-[#a39a89]">{list.length ? tr("No posters yet") : tr("Nothing added yet")}</span>
                )}
              </div>
            </Link>
          );
        })}
      </section>

      <section className={card}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Your recommendations")}</h2>
          <span className="text-xs text-[#8f8676]">{tr("highest score first")}</span>
        </div>
        <PosterRow list={s.recommended.slice(0, 20)} empty="Tick the ✓ box on a title to recommend it." />
      </section>

      {s.watching.length ? (
        <section className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Watching now")}</h2>
          <PosterRow list={s.watching} empty="" />
        </section>
      ) : null}

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Watched per year")}</h2>
          <p className="mb-5 text-xs text-[#6f675b]">{tr("Titles by the year you watched them")}</p>
          <VBars rows={s.yearRows} unit="{n} titles" empty="Add “year you watched it” to see this." />
        </div>
        <div className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("How you score")}</h2>
          <p className="mb-5 text-xs text-[#6f675b]">{tr("{n} graded titles by score, 1–10", { n: s.scored })}</p>
          <VBars rows={s.scored ? s.scoreRows : []} unit="{n} titles" empty="Grade a title to see this." />
        </div>
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Top genres")}</h2>
          {s.genreRows.length ? <HBars rows={s.genreRows} total={items.length} unit="{n} titles" /> : <p className="text-xs text-[#8f8676]">{tr("No genres yet.")}</p>}
        </div>
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Actors you watch most")}</h2>
          {s.actorRows.length ? (
            <HBars rows={s.actorRows} total={s.watched.length} unit="{n} watched titles" />
          ) : (
            <p className="text-xs text-[#8f8676]">{tr("Shows once an actor appears in two or more watched titles.")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
