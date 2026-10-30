"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CINEMA_KINDS, cinemaKindMeta } from "@/features/cinema/nav";
import { watchedMinutes, type CinemaTitle } from "@/features/cinema/types";
import { Poster, ScoreBadge } from "@/features/cinema/ui";
import { AchievementsCard } from "@/features/cinema/achievements";
import { CinemaAiPicks } from "@/features/cinema/ai-picks";
import { downloadCsv } from "@/features/cinema/export";
import { Franchises } from "@/features/cinema/franchises";
import { CinemaAnalytics } from "@/features/cinema/overview-analytics";
import { TonightPicker } from "@/features/cinema/tonight";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

function avgScore(list: CinemaTitle[]): number | null {
  const s = list.filter((t) => t.score != null);
  return s.length ? s.reduce((a, t) => a + (t.score ?? 0), 0) / s.length : null;
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
  const locale = useLocale();
  const [thisYear] = useState(() => new Date().getFullYear());

  const s = useMemo(() => {
    const watched = items.filter((t) => t.status === "watched");
    // You vs IMDb on the titles that have both.
    const both = items.filter((t) => t.score != null && t.imdb_rating != null);
    const vsImdb = both.length
      ? { n: both.length, mine: both.reduce((a, t) => a + (t.score ?? 0), 0) / both.length, imdb: both.reduce((a, t) => a + (t.imdb_rating ?? 0), 0) / both.length }
      : null;
    const minutes = items.filter((t) => t.view_year === thisYear).reduce((a, t) => a + watchedMinutes(t), 0);
    return {
      watched,
      avg: avgScore(items),
      recommended: [...items.filter((t) => t.recommended)].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      watching: items.filter((t) => t.status === "watching"),
      planned: items.filter((t) => t.status === "planned").length,
      thisYear: items.filter((t) => t.view_year === thisYear && t.status !== "planned").length,
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
    { label: tr("Watched in {year}", { year: thisYear }), value: String(s.thisYear), sub: s.hours ? tr("~{n} h of watching this year", { n: s.hours.toLocaleString(locale) }) : tr("by year watched") },
  ];

  return (
    <div className="space-y-5">
      {items.length ? (
        <div className="-mb-2 flex justify-end">
          <button type="button" onClick={() => downloadCsv(items, `cinematography-${new Date().toISOString().slice(0, 10)}.csv`)} className={investingToolbarBtn}>
            {tr("Export all to CSV")}
          </button>
        </div>
      ) : null}
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

      <AchievementsCard />

      <TonightPicker />

      <CinemaAiPicks />

      <CinemaAnalytics items={items} />

      <Franchises />
    </div>
  );
}
