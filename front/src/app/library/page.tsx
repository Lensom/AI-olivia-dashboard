"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Poster } from "@/features/cinema/ui";
import { LIBRARY_KINDS, libraryKindMeta } from "@/features/library/nav";
import type { LibraryItem } from "@/features/library/types";
import { Stars } from "@/features/library/ui";
import { HBars, VBars } from "@/features/shared/bar-charts";
import { useLibrary } from "@/state/library-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

function avgScore(list: LibraryItem[]): number | null {
  const s = list.filter((t) => t.score != null);
  return s.length ? s.reduce((a, t) => a + (t.score ?? 0), 0) / s.length : null;
}

function countBy(list: LibraryItem[], keys: (t: LibraryItem) => string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) for (const k of keys(t)) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}

function CoverRow({ list, empty }: { list: LibraryItem[]; empty: string }) {
  if (!list.length) return <p className="text-xs text-[#8f8676]">{empty}</p>;
  return (
    <ul className="flex gap-3 overflow-x-auto pb-1">
      {list.map((t) => (
        <li key={t.id} className="w-24 shrink-0">
          <Link href={`/library/${libraryKindMeta(t.kind).slug}`} className="group block">
            <Poster src={t.cover} title={t.title} className="aspect-[2/3] w-24 text-lg transition group-hover:-translate-y-0.5" />
            <span className="mt-1 block truncate text-xs font-medium text-[#1f1c17]">{t.title}</span>
            <span className="block truncate text-[11px] text-[#8f8676]">{t.authors[0] ?? libraryKindMeta(t.kind).label}</span>
            <Stars score={t.score} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function LibraryOverview() {
  const { items, isLoaded, loadError } = useLibrary();
  const [thisYear] = useState(() => new Date().getFullYear());

  const s = useMemo(() => {
    const read = items.filter((t) => t.status === "read");
    const finishedYears = read.map((t) => Number(t.finish_date.slice(0, 4))).filter((y) => y > 1900);
    const perYear = countBy(read, (t) => (t.finish_date ? [t.finish_date.slice(0, 4)] : []));
    const yearRows: [string, number][] = [];
    if (finishedYears.length) {
      for (let y = Math.min(...finishedYears); y <= Math.max(...finishedYears); y++) yearRows.push([String(y), perYear.get(String(y)) ?? 0]);
    }
    const thisYearRead = read.filter((t) => t.finish_date.startsWith(String(thisYear)));
    const lastYearRead = read.filter((t) => t.finish_date.startsWith(String(thisYear - 1))).length;
    const scoreCounts = countBy(items, (t) => (t.score != null ? [String(Math.round(t.score))] : []));
    return {
      read,
      avg: avgScore(items),
      planned: items.filter((t) => t.status === "planned").length,
      reading: items.filter((t) => t.status === "reading"),
      recommended: [...items.filter((t) => t.recommended)].sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.finish_date.localeCompare(a.finish_date)),
      recent: [...read].filter((t) => t.finish_date).sort((a, b) => b.finish_date.localeCompare(a.finish_date)).slice(0, 12),
      thisYear: thisYearRead.length,
      lastYear: lastYearRead,
      pagesThisYear: thisYearRead.reduce((a, t) => a + (t.pages ?? 0), 0),
      pagesTotal: read.reduce((a, t) => a + (t.pages ?? 0), 0),
      yearRows,
      scoreRows: [1, 2, 3, 4, 5].map((n) => [`${n}★`, scoreCounts.get(String(n)) ?? 0] as [string, number]),
      scored: [...scoreCounts.values()].reduce((a, n) => a + n, 0),
      genreRows: [...countBy(items, (t) => t.genres).entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      authorRows: [...countBy(read, (t) => t.authors).entries()].filter((r) => r[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 8),
    };
  }, [items, thisYear]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{loadError}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">Loading…</p>;

  const stats = [
    { label: "Titles", value: String(items.length), sub: `${s.read.length} read · ${s.reading.length} reading · ${s.planned} want to read` },
    { label: "Average score", value: s.avg != null ? `★ ${s.avg.toFixed(1)}` : "—", sub: "your grades, out of 5" },
    {
      label: `Read in ${thisYear}`,
      value: String(s.thisYear),
      sub: `${s.lastYear} in ${thisYear - 1}${s.pagesThisYear ? ` · ${s.pagesThisYear.toLocaleString("en-US")} pages` : ""}`,
    },
    { label: "Recommended", value: String(s.recommended.length), sub: s.pagesTotal ? `${s.pagesTotal.toLocaleString("en-US")} pages read in total` : "ticked as worth reading" },
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

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LIBRARY_KINDS.map((k) => {
          const list = items.filter((t) => t.kind === k.kind);
          const avg = avgScore(list);
          const covers = [...list].filter((t) => t.cover).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4);
          return (
            <Link key={k.kind} href={`/library/${k.slug}`} className={`${card} group block transition hover:-translate-y-0.5 hover:bg-white`}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-[#1f1c17]">{k.label}</h2>
                <span className="text-xs text-[#8f8676] group-hover:text-[#1f1c17]">Open →</span>
              </div>
              <p className="mt-0.5 text-xs text-[#6f675b]">{list.length ? `${list.length} titles${avg != null ? ` · avg ★ ${avg.toFixed(1)}` : ""}` : k.description}</p>
              <div className="mt-3 flex h-[72px] gap-1.5">
                {covers.length ? (
                  covers.map((t) => <Poster key={t.id} src={t.cover} title={t.title} className="h-[72px] w-12" />)
                ) : (
                  <span className="self-center text-xs text-[#a39a89]">{list.length ? "No covers yet" : "Nothing added yet"}</span>
                )}
              </div>
            </Link>
          );
        })}
      </section>

      {s.reading.length ? (
        <section className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">Reading now</h2>
          <CoverRow list={s.reading} empty="" />
        </section>
      ) : null}

      <section className={card}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#1f1c17]">Your recommendations</h2>
          <span className="text-xs text-[#8f8676]">highest score first</span>
        </div>
        <CoverRow list={s.recommended.slice(0, 20)} empty="Tick the ✓ box on a book to recommend it." />
      </section>

      <section className={card}>
        <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">Recently finished</h2>
        <CoverRow list={s.recent} empty="Add a finish date to see your latest reads." />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">Finished per year</h2>
          <p className="mb-5 text-xs text-[#6f675b]">Titles read, by the year you finished them</p>
          <VBars rows={s.yearRows} unit="titles" empty="Add finish dates to see this." />
        </div>
        <div className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">How you score</h2>
          <p className="mb-5 text-xs text-[#6f675b]">{s.scored} graded titles by stars</p>
          <VBars rows={s.scored ? s.scoreRows : []} unit="titles" empty="Grade a title to see this." />
        </div>
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">Top genres</h2>
          {s.genreRows.length ? <HBars rows={s.genreRows} total={items.length} unit="titles" /> : <p className="text-xs text-[#8f8676]">No genres yet.</p>}
        </div>
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">Authors you read most</h2>
          {s.authorRows.length ? (
            <HBars rows={s.authorRows} total={s.read.length} unit="books read" />
          ) : (
            <p className="text-xs text-[#8f8676]">Shows once you&apos;ve read two or more books by the same author.</p>
          )}
        </div>
      </section>
    </div>
  );
}
