"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Poster } from "@/features/cinema/ui";
import { LIBRARY_KINDS, libraryKindMeta } from "@/features/library/nav";
import type { LibraryItem } from "@/features/library/types";
import { Stars } from "@/features/library/ui";
import { HBars, VBars } from "@/features/shared/bar-charts";
import { useLocale, useT } from "@/lib/i18n";
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
  const tr = useT();
  if (!list.length) return <p className="text-xs text-[#8f8676]">{tr(empty)}</p>;
  return (
    <ul className="flex gap-3 overflow-x-auto pb-1">
      {list.map((t) => (
        <li key={t.id} className="w-24 shrink-0">
          <Link href={`/library/${libraryKindMeta(t.kind).slug}`} className="group block">
            <Poster src={t.cover} title={t.title} className="aspect-[2/3] w-24 text-lg transition group-hover:-translate-y-0.5" />
            <span className="mt-1 block truncate text-xs font-medium text-[#1f1c17]">{t.title}</span>
            <span className="block truncate text-[11px] text-[#8f8676]">{t.authors[0] ?? tr(libraryKindMeta(t.kind).label)}</span>
            <Stars score={t.score} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function LibraryOverview() {
  const { items, isLoaded, loadError } = useLibrary();
  const tr = useT();
  const locale = useLocale();
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

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{tr(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{tr("Loading…")}</p>;

  const stats = [
    {
      label: tr("Titles"),
      value: String(items.length),
      sub: tr("{read} read · {reading} reading · {planned} want to read", { read: s.read.length, reading: s.reading.length, planned: s.planned }),
    },
    { label: tr("Average score"), value: s.avg != null ? `★ ${s.avg.toFixed(1)}` : "—", sub: tr("your grades, out of 5") },
    {
      label: tr("Read in {year}", { year: thisYear }),
      value: String(s.thisYear),
      sub:
        tr("{n} in {year}", { n: s.lastYear, year: thisYear - 1 }) +
        (s.pagesThisYear ? ` · ${tr("{n} pages", { n: s.pagesThisYear }).replace(String(s.pagesThisYear), s.pagesThisYear.toLocaleString(locale))}` : ""),
    },
    {
      label: tr("Recommended"),
      value: String(s.recommended.length),
      sub: s.pagesTotal
        ? tr("{n} pages read in total", { n: s.pagesTotal }).replace(String(s.pagesTotal), s.pagesTotal.toLocaleString(locale))
        : tr("ticked as worth reading"),
    },
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
                <h2 className="text-base font-semibold text-[#1f1c17]">{tr(k.label)}</h2>
                <span className="text-xs text-[#8f8676] group-hover:text-[#1f1c17]">{tr("Open →")}</span>
              </div>
              <p className="mt-0.5 text-xs text-[#6f675b]">{list.length
                  ? tr("{n} titles", { n: list.length }) + (avg != null ? ` · ${tr("avg {v}", { v: `★ ${avg.toFixed(1)}` })}` : "")
                  : tr(k.description)}</p>
              <div className="mt-3 flex h-[72px] gap-1.5">
                {covers.length ? (
                  covers.map((t) => <Poster key={t.id} src={t.cover} title={t.title} className="h-[72px] w-12" />)
                ) : (
                  <span className="self-center text-xs text-[#a39a89]">{list.length ? tr("No covers yet") : tr("Nothing added yet")}</span>
                )}
              </div>
            </Link>
          );
        })}
      </section>

      {s.reading.length ? (
        <section className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Reading now")}</h2>
          <CoverRow list={s.reading} empty="" />
        </section>
      ) : null}

      <section className={card}>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Your recommendations")}</h2>
          <span className="text-xs text-[#8f8676]">{tr("highest score first")}</span>
        </div>
        <CoverRow list={s.recommended.slice(0, 20)} empty="Tick the ✓ box on a book to recommend it." />
      </section>

      <section className={card}>
        <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Recently finished")}</h2>
        <CoverRow list={s.recent} empty="Add a finish date to see your latest reads." />
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Finished per year")}</h2>
          <p className="mb-5 text-xs text-[#6f675b]">{tr("Titles read, by the year you finished them")}</p>
          <VBars rows={s.yearRows} unit="{n} titles" empty="Add finish dates to see this." />
        </div>
        <div className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("How you score")}</h2>
          <p className="mb-5 text-xs text-[#6f675b]">{tr("{n} graded titles by stars", { n: s.scored })}</p>
          <VBars rows={s.scored ? s.scoreRows : []} unit="{n} titles" empty="Grade a title to see this." />
        </div>
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Top genres")}</h2>
          {s.genreRows.length ? <HBars rows={s.genreRows} total={items.length} unit="{n} titles" /> : <p className="text-xs text-[#8f8676]">{tr("No genres yet.")}</p>}
        </div>
        <div className={card}>
          <h2 className="mb-3 text-sm font-semibold text-[#1f1c17]">{tr("Authors you read most")}</h2>
          {s.authorRows.length ? (
            <HBars rows={s.authorRows} total={s.read.length} unit="{n} books read" />
          ) : (
            <p className="text-xs text-[#8f8676]">{tr("Shows once you’ve read two or more books by the same author.")}</p>
          )}
        </div>
      </section>
    </div>
  );
}
