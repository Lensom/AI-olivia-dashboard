"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CINEMA_KINDS, cinemaKindMeta } from "@/features/cinema/nav";
import { isSeries, watchedMinutes, type CinemaTitle } from "@/features/cinema/types";
import { Poster, ScoreBadge } from "@/features/cinema/ui";
import { useLocale, useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

const byScore = (a: CinemaTitle, b: CinemaTitle) => (b.score ?? -1) - (a.score ?? -1) || (b.imdb_rating ?? -1) - (a.imdb_rating ?? -1) || a.title.localeCompare(b.title);

type Group = { name: string; n: number; avg: number | null };

/** The most-watched names in a list (genres, directors), with your average score; ties go to the better-liked. */
function favourite(list: CinemaTitle[], pick: (t: CinemaTitle) => string[], min: number): Group | null {
  const groups = new Map<string, CinemaTitle[]>();
  for (const t of list) for (const name of new Set(pick(t))) groups.set(name, [...(groups.get(name) ?? []), t]);
  const ranked = [...groups]
    .filter(([, g]) => g.length >= min)
    .map(([name, g]): Group => {
      const scored = g.filter((t) => t.score != null);
      return { name, n: g.length, avg: scored.length ? scored.reduce((s, t) => s + (t.score ?? 0), 0) / scored.length : null };
    })
    .sort((a, b) => b.n - a.n || (b.avg ?? 0) - (a.avg ?? 0));
  return ranked[0] ?? null;
}

/** Your year in film: what you watched in a year (by the year you watched it), its best, its surprises and its hours. */
function summarize(items: CinemaTitle[], year: number) {
  const list = items.filter((t) => t.view_year === year && (t.status === "watched" || t.status === "watching"));
  const scored = list.filter((t) => t.score != null);
  const vsImdb = list.filter((t) => t.score != null && t.imdb_rating != null);
  const diff = (t: CinemaTitle) => (t.score ?? 0) - (t.imdb_rating ?? 0);
  // Liked far more than the crowd: your discovery of the year. Liked far less: the letdown.
  const discovery = [...vsImdb].filter((t) => (t.score ?? 0) >= 8 && diff(t) > 0).sort((a, b) => diff(b) - diff(a))[0] ?? null;
  const letdown = [...vsImdb].filter((t) => diff(t) <= -1.5).sort((a, b) => diff(a) - diff(b))[0] ?? null;
  return {
    list,
    count: list.length,
    byKind: CINEMA_KINDS.map((k) => ({ kind: k, n: list.filter((t) => t.kind === k.kind).length })).filter((x) => x.n),
    minutes: list.reduce((s, t) => s + watchedMinutes(t), 0),
    hasSeries: list.some((t) => isSeries(t.kind)),
    avg: scored.length ? scored.reduce((s, t) => s + (t.score ?? 0), 0) / scored.length : null,
    inCinema: list.filter((t) => t.in_cinema).length,
    top: [...scored].sort(byScore).slice(0, 5),
    discovery,
    letdown,
    genre: favourite(list, (t) => t.genres, 2),
    director: favourite(list.filter((t) => !isSeries(t.kind)), (t) => t.directors, 2),
    wall: [...list].filter((t) => t.poster).sort(byScore),
  };
}

function Pick({ t, caption, note }: { t: CinemaTitle; caption: string; note: string }) {
  return (
    <Link href={`/cinematography/${cinemaKindMeta(t.kind).slug}`} className={`${card} flex gap-3 transition hover:bg-white`}>
      <Poster src={t.poster} title={t.title} className="aspect-[2/3] w-16 shrink-0 text-sm" />
      <div className="min-w-0">
        <p className={label}>{caption}</p>
        <p className="mt-1 font-semibold text-[#1f1c17]">{t.title}</p>
        <p className="mt-0.5 text-xs text-[#6f675b]">{note}</p>
      </div>
    </Link>
  );
}

export default function CinemaYearPage() {
  const t = useT();
  const locale = useLocale();
  const { items, isLoaded, loadError } = useCinema();
  const years = useMemo(
    () => [...new Set(items.filter((x) => x.view_year && (x.status === "watched" || x.status === "watching")).map((x) => x.view_year!))].sort((a, b) => b - a),
    [items],
  );
  const [chosen, setChosen] = useState<number | null>(null);
  const year = chosen ?? years[0] ?? new Date().getFullYear();
  const s = useMemo(() => summarize(items, year), [items, year]);
  const before = useMemo(() => summarize(items, year - 1).count, [items, year]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;
  if (!years.length) return <p className={`${card} text-center text-sm text-[#8f8676]`}>{t("Set the year you watched a title, and your years in film show up here.")}</p>;

  const hours = Math.round(s.minutes / 60);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Year")}>
        {years.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setChosen(y)}
            aria-pressed={y === year}
            className={`rounded-full px-3 py-1 text-xs font-medium tabular-nums ${y === year ? "bg-[#1f1c17] text-[#f8f4eb]" : "border border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`}
          >
            {y}
          </button>
        ))}
      </div>

      <section className="rounded-2xl bg-[#1f1c17] p-5 text-[#f8f4eb] sm:p-7">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#bfb6a5]">{t("Your {year} in film", { year })}</p>
        <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-3xl font-semibold tabular-nums sm:text-4xl">{s.count}</p>
            <p className="text-xs text-[#bfb6a5]">
              {t("titles watched")}
              {before ? ` · ${s.count >= before ? "+" : ""}${s.count - before} ${t("vs {year}", { year: year - 1 })}` : ""}
            </p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums sm:text-4xl">{hours ? `${s.hasSeries ? "~" : ""}${hours.toLocaleString(locale)}` : "—"}</p>
            <p className="text-xs text-[#bfb6a5]">{t("hours")}{s.hasSeries ? ` · ${t("series counted by the seasons you've seen")}` : ""}</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums sm:text-4xl">{s.avg != null ? s.avg.toFixed(1) : "—"}</p>
            <p className="text-xs text-[#bfb6a5]">{t("your average score")}</p>
          </div>
          <div>
            <p className="text-3xl font-semibold tabular-nums sm:text-4xl">{s.inCinema}</p>
            <p className="text-xs text-[#bfb6a5]">{t("in the cinema")}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-[#bfb6a5]">{s.byKind.map((x) => `${t(x.kind.count, { n: x.n })}`).join(" · ")}</p>
      </section>

      {s.top.length ? (
        <section className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("Best of {year}", { year })}</h2>
          <ol className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {s.top.map((x, i) => (
              <li key={x.id} className="min-w-0">
                <Link href={`/cinematography/${cinemaKindMeta(x.kind).slug}`} className="group block">
                  <span className="relative block">
                    <Poster src={x.poster} title={x.title} className="aspect-[2/3] w-full text-lg transition group-hover:-translate-y-0.5" />
                    <span className="absolute left-1.5 top-1.5 rounded-full bg-[#1f1c17] px-1.5 text-[11px] font-semibold text-white">#{i + 1}</span>
                    <span className="absolute right-1 top-1">
                      <ScoreBadge score={x.score} />
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-xs font-medium text-[#1f1c17]">{x.title}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        {s.discovery ? (
          <Pick
            t={s.discovery}
            caption={t("Discovery of the year")}
            note={t("You gave it {mine}, IMDb has {imdb}: you liked it more than most.", { mine: s.discovery.score ?? "", imdb: s.discovery.imdb_rating?.toFixed(1) ?? "" })}
          />
        ) : null}
        {s.letdown ? (
          <Pick
            t={s.letdown}
            caption={t("Letdown of the year")}
            note={t("You gave it {mine}, IMDb has {imdb}.", { mine: s.letdown.score ?? "", imdb: s.letdown.imdb_rating?.toFixed(1) ?? "" })}
          />
        ) : null}
        {s.genre ? (
          <div className={card}>
            <p className={label}>{t("Genre of the year")}</p>
            <p className="mt-1 font-semibold text-[#1f1c17]">{s.genre.name}</p>
            <p className="mt-0.5 text-xs text-[#6f675b]">
              {t("{n} titles", { n: s.genre.n })}
              {s.genre.avg != null ? ` · ${t("avg {v}", { v: s.genre.avg.toFixed(1) })}` : ""}
            </p>
          </div>
        ) : null}
        {s.director ? (
          <div className={card}>
            <p className={label}>{t("Director of the year")}</p>
            <p className="mt-1 font-semibold text-[#1f1c17]">{s.director.name}</p>
            <p className="mt-0.5 text-xs text-[#6f675b]">
              {t("{n} films", { n: s.director.n })}
              {s.director.avg != null ? ` · ${t("avg {v}", { v: s.director.avg.toFixed(1) })}` : ""}
            </p>
          </div>
        ) : null}
      </section>

      {s.wall.length ? (
        <section className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("Everything you watched in {year}", { year })}</h2>
          <ul className="mt-3 grid grid-cols-5 gap-1.5 sm:grid-cols-8 lg:grid-cols-12">
            {s.wall.map((x) => (
              <li key={x.id} title={`${x.title}${x.score != null ? ` · ${x.score}` : ""}`}>
                <Poster src={x.poster} title={x.title} className="aspect-[2/3] w-full text-[10px]" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
