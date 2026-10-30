"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CINEMA_KINDS, cinemaKindMeta } from "@/features/cinema/nav";
import { isSeries, newSeasons, watchedMinutes, type CinemaKind, type CinemaTitle } from "@/features/cinema/types";
import { Poster, ScoreBadge } from "@/features/cinema/ui";
import { HBars, VBars } from "@/features/shared/bar-charts";
import { useLocale, useT } from "@/lib/i18n";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const BAR = "#2a78d6";

function countBy(list: CinemaTitle[], keys: (t: CinemaTitle) => (string | number)[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of list) for (const k of new Set(keys(t))) m.set(String(k), (m.get(String(k)) ?? 0) + 1);
  return m;
}

/** Average score per group (genre, director…), only for groups with at least `min` graded titles. */
function avgBy(list: CinemaTitle[], keys: (t: CinemaTitle) => string[], min: number): { label: string; avg: number; n: number }[] {
  const m = new Map<string, { sum: number; n: number }>();
  for (const t of list) {
    if (t.score == null) continue;
    for (const k of new Set(keys(t))) {
      const cur = m.get(k) ?? { sum: 0, n: 0 };
      cur.sum += t.score;
      cur.n += 1;
      m.set(k, cur);
    }
  }
  return [...m.entries()].filter(([, v]) => v.n >= min).map(([label, v]) => ({ label, avg: v.sum / v.n, n: v.n }));
}

/** Single-series bars of an average score out of 10; the value and title count are always printed. */
function ScoreBars({ rows }: { rows: { label: string; avg: number; n: number }[] }) {
  const t = useT();
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className="group grid grid-cols-[minmax(0,9rem)_1fr_4.5rem] items-center gap-2 text-xs"
          title={`${r.label}: ${r.avg.toFixed(2)} / 10 · ${t("{n} titles", { n: r.n })}`}
        >
          <span className="truncate text-[#3b352d]">{r.label}</span>
          <span className="h-3 rounded-r bg-[#f3efe5]">
            <span className="block h-full rounded-r transition-opacity group-hover:opacity-80" style={{ width: `${(r.avg / 10) * 100}%`, background: BAR }} />
          </span>
          <span className="text-right tabular-nums text-[#6f675b]">
            <span className="font-semibold text-[#1f1c17]">{r.avg.toFixed(1)}</span> · {r.n}
          </span>
        </li>
      ))}
    </ul>
  );
}

function MiniRow({ t, right }: { t: CinemaTitle; right: React.ReactNode }) {
  const tr = useT();
  return (
    <li>
      <Link href={`/cinematography/${cinemaKindMeta(t.kind).slug}`} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 hover:bg-[#faf8f2]">
        <Poster src={t.poster} title={t.title} className="h-10 w-7 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-[#1f1c17]">{t.title}</span>
          <span className="block truncate text-[11px] text-[#8f8676]">{[tr(cinemaKindMeta(t.kind).label), t.year].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="shrink-0 text-right text-xs tabular-nums">{right}</span>
      </Link>
    </li>
  );
}

const Empty = ({ text }: { text: string }) => {
  const t = useT();
  return <p className="text-xs text-[#8f8676]">{t(text)}</p>;
};

/** Charts and insights over all titles or one kind (Films, Series…), chosen with the chips on top. */
export function CinemaAnalytics({ items }: { items: CinemaTitle[] }) {
  const t = useT();
  const locale = useLocale();
  const [scope, setScope] = useState<CinemaKind | "all">("all");
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const kindsPresent = CINEMA_KINDS.filter((k) => items.some((x) => x.kind === k.kind));

  const a = useMemo(() => {
    const pool = scope === "all" ? items : items.filter((x) => x.kind === scope);
    const seen = pool.filter((x) => x.status !== "planned");
    const watched = pool.filter((x) => x.status === "watched");

    const years = seen.map((x) => x.view_year).filter((y): y is number => y != null);
    const perYear = countBy(seen, (x) => (x.view_year != null ? [x.view_year] : []));
    const yearRows: [string, number][] = [];
    if (years.length) for (let y = Math.min(...years); y <= Math.max(...years); y++) yearRows.push([String(y), perYear.get(String(y)) ?? 0]);

    const decades = seen.map((x) => x.year).filter((y): y is number => y != null).map((y) => Math.floor(y / 10) * 10);
    const perDecade = countBy(seen, (x) => (x.year ? [Math.floor(x.year / 10) * 10] : []));
    const decadeRows: [string, number][] = [];
    if (decades.length)
      for (let d = Math.min(...decades); d <= Math.max(...decades); d += 10) decadeRows.push([t("{d}s", { d }), perDecade.get(String(d)) ?? 0]);

    const scoreCounts = countBy(pool, (x) => (x.score != null ? [Math.round(x.score)] : []));
    const scored = [...scoreCounts.values()].reduce((s, n) => s + n, 0);

    // You vs IMDb: the titles where your grade and the crowd's differ most.
    const paired = pool.filter((x) => x.score != null && x.imdb_rating != null).map((x) => ({ x, diff: x.score! - x.imdb_rating! }));
    const avgDiff = paired.length ? paired.reduce((s, p) => s + p.diff, 0) / paired.length : null;
    const agree = paired.length ? paired.filter((p) => Math.abs(p.diff) <= 1).length / paired.length : null;

    const isFilm = (x: CinemaTitle) => x.tmdb_media === "movie" || (!x.tmdb_media && !isSeries(x.kind));
    const filmMinutes = watched.filter(isFilm).reduce((s, x) => s + watchedMinutes(x), 0);
    const seriesMinutes = seen.filter((x) => !isFilm(x)).reduce((s, x) => s + watchedMinutes(x), 0);
    const filmsWithRuntime = watched.filter((x) => isFilm(x) && x.runtime).length;
    const hoursPerYear = new Map<number, number>();
    for (const x of seen) if (x.view_year != null) hoursPerYear.set(x.view_year, (hoursPerYear.get(x.view_year) ?? 0) + watchedMinutes(x) / 60);
    const hourRows: [string, number][] = yearRows.map(([y]) => [y, Math.round(hoursPerYear.get(Number(y)) ?? 0)]);

    // Announced episodes and premieres for what you follow or plan to watch, soonest first.
    const upcoming = pool
      .filter((x) => x.next_air_date && x.next_air_date >= today && x.status !== "dropped")
      .sort((p, q) => p.next_air_date.localeCompare(q.next_air_date))
      .slice(0, 8);

    return {
      total: pool.length,
      yearRows,
      decadeRows,
      scoreRows: Array.from({ length: 10 }, (_, i) => [String(i + 1), scoreCounts.get(String(i + 1)) ?? 0] as [string, number]),
      scored,
      genreCount: [...countBy(pool, (x) => x.genres).entries()].sort((p, q) => q[1] - p[1]).slice(0, 8),
      genreAvg: avgBy(pool, (x) => x.genres, 3).sort((p, q) => q.avg - p.avg || q.n - p.n).slice(0, 8),
      directors: avgBy(watched, (x) => x.directors, 2).sort((p, q) => q.n - p.n || q.avg - p.avg).slice(0, 8),
      actors: [...countBy(watched, (x) => x.actors).entries()].filter((r) => r[1] > 1).sort((p, q) => q[1] - p[1]).slice(0, 8),
      studios: [...countBy(seen, (x) => x.studios).entries()].filter((r) => r[1] > 1).sort((p, q) => q[1] - p[1]).slice(0, 8),
      seenCount: seen.length,
      watchedCount: watched.length,
      paired: paired.length,
      avgDiff,
      agree,
      above: [...paired].filter((p) => p.diff > 0).sort((p, q) => q.diff - p.diff).slice(0, 5),
      below: [...paired].filter((p) => p.diff < 0).sort((p, q) => p.diff - q.diff).slice(0, 5),
      // Watchlist: what's planned, best-rated first.
      next: pool
        .filter((x) => x.status === "planned")
        .sort((p, q) => (q.imdb_rating ?? 0) - (p.imdb_rating ?? 0) || Number(q.recommended) - Number(p.recommended))
        .slice(0, 8),
      plannedCount: pool.filter((x) => x.status === "planned").length,
      behind: pool.filter((x) => isSeries(x.kind) && newSeasons(x) > 0).sort((p, q) => newSeasons(q) - newSeasons(p)).slice(0, 8),
      hours: Math.round((filmMinutes + seriesMinutes) / 60),
      filmHours: Math.round(filmMinutes / 60),
      seriesHours: Math.round(seriesMinutes / 60),
      hourRows: hourRows.some((r) => r[1] > 0) ? hourRows : [],
      upcoming,
      avgRuntime: filmsWithRuntime ? Math.round(filmMinutes / filmsWithRuntime) : null,
      dropped: pool.filter((x) => x.status === "dropped").length,
    };
  }, [items, scope, t, today]);

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1 text-xs font-medium transition ${
      active ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"
    }`;
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h2 className="text-lg font-semibold text-[#1f1c17]">{t("Deeper look")}</h2>
          <p className="text-xs text-[#6f675b]">{t("Charts and insights for all titles or one type. {n} titles in view.", { n: a.total })}</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Which titles")}>
          <button type="button" onClick={() => setScope("all")} className={chip(scope === "all")} aria-pressed={scope === "all"}>
            {t("All")}
          </button>
          {kindsPresent.map((k) => (
            <button key={k.kind} type="button" onClick={() => setScope(k.kind)} className={chip(scope === k.kind)} aria-pressed={scope === k.kind}>
              {t(k.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Quick facts */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: t("You vs IMDb"),
            value: a.avgDiff == null ? "—" : signed(a.avgDiff),
            sub: a.avgDiff == null ? t("Fill from TMDB to compare") : a.avgDiff >= 0 ? t("you grade above the crowd on average") : t("you grade below the crowd on average"),
          },
          {
            label: t("Agree with IMDb"),
            value: a.agree == null ? "—" : `${Math.round(a.agree * 100)}%`,
            sub: t("within ±1 point, {n} titles", { n: a.paired }),
          },
          {
            label: t("Time watched, all years"),
            value: a.hours ? t("{n} h", { n: a.hours.toLocaleString(locale) }) : "—",
            sub: a.hours
              ? t("films {f} h · series {s} h", { f: a.filmHours.toLocaleString(locale), s: a.seriesHours.toLocaleString(locale) })
              : t("runtime comes from TMDB"),
          },
          {
            label: t("Watchlist"),
            value: String(a.plannedCount),
            sub: a.dropped ? t("{n} dropped", { n: a.dropped }) : t("planned to watch"),
          },
        ].map((x) => (
          <div key={x.label} className={card}>
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{x.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">{x.value}</p>
            <p className="mt-0.5 text-xs text-[#6f675b]">{x.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("Watched per year")}</h3>
          <p className="mb-5 text-xs text-[#6f675b]">{t("Titles by the year you watched them")}</p>
          <VBars rows={a.yearRows} unit="{n} titles" empty="Add “year you watched it” to see this." />
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("Hours per year")}</h3>
          <p className="mb-5 text-xs text-[#6f675b]">
            {a.avgRuntime ? t("Films and series by the year you watched them · avg film {n} min", { n: a.avgRuntime }) : t("Films and series by the year you watched them")}
          </p>
          <VBars rows={a.hourRows} unit="{n} h" empty="Needs runtimes from TMDB and “year you watched it”." />
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("How you score")}</h3>
          <p className="mb-5 text-xs text-[#6f675b]">{t("{n} graded titles by score, 1–10", { n: a.scored })}</p>
          <VBars rows={a.scored ? a.scoreRows : []} unit="{n} titles" empty="Grade a title to see this." />
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("By release decade")}</h3>
          <p className="mb-5 text-xs text-[#6f675b]">{t("When the titles you've seen came out")}</p>
          <VBars rows={a.decadeRows} unit="{n} titles" empty="Release years come from TMDB or your import." />
        </div>
        <div className={card}>
          <h3 className="mb-3 text-sm font-semibold text-[#1f1c17]">{t("Top genres")}</h3>
          {a.genreCount.length ? <HBars rows={a.genreCount} total={a.total} unit="{n} titles" /> : <Empty text="No genres yet." />}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("Best-rated genres")}</h3>
          <p className="mb-3 text-xs text-[#6f675b]">{t("Your average score, genres with 3+ graded titles")}</p>
          {a.genreAvg.length ? <ScoreBars rows={a.genreAvg} /> : <Empty text="Grade more titles to see this." />}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("Directors you return to")}</h3>
          <p className="mb-3 text-xs text-[#6f675b]">{t("2+ watched titles; your average score")}</p>
          {a.directors.length ? <ScoreBars rows={a.directors} /> : <Empty text="Directors come from TMDB (Fill from TMDB)." />}
        </div>
        <div className={card}>
          <h3 className="mb-3 text-sm font-semibold text-[#1f1c17]">{t("Actors you watch most")}</h3>
          {a.actors.length ? (
            <HBars rows={a.actors} total={a.watchedCount} unit="{n} watched titles" />
          ) : (
            <Empty text="Shows once an actor appears in two or more watched titles." />
          )}
        </div>
        <div className={card}>
          <h3 className="mb-3 text-sm font-semibold text-[#1f1c17]">{t("Studios")}</h3>
          {a.studios.length ? <HBars rows={a.studios} total={a.seenCount} unit="{n} titles" /> : <Empty text="Shows once a studio appears in two or more titles." />}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("You liked more than IMDb")}</h3>
          <p className="mb-2 text-xs text-[#6f675b]">{t("Your hidden gems: biggest gap above the crowd")}</p>
          {a.above.length ? (
            <ul>
              {a.above.map(({ x, diff }) => (
                <MiniRow
                  key={x.id}
                  t={x}
                  right={
                    <>
                      <ScoreBadge score={x.score} /> <span className="text-[#8f8676]">IMDb {x.imdb_rating!.toFixed(1)}</span>
                      <span className="block font-semibold text-emerald-700">{signed(diff)}</span>
                    </>
                  }
                />
              ))}
            </ul>
          ) : (
            <Empty text="Nothing yet: needs your score and an IMDb rating." />
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("You liked less than IMDb")}</h3>
          <p className="mb-2 text-xs text-[#6f675b]">{t("Overrated for you: biggest gap below the crowd")}</p>
          {a.below.length ? (
            <ul>
              {a.below.map(({ x, diff }) => (
                <MiniRow
                  key={x.id}
                  t={x}
                  right={
                    <>
                      <ScoreBadge score={x.score} /> <span className="text-[#8f8676]">IMDb {x.imdb_rating!.toFixed(1)}</span>
                      <span className="block font-semibold text-rose-700">{signed(diff)}</span>
                    </>
                  }
                />
              ))}
            </ul>
          ) : (
            <Empty text="Nothing yet: needs your score and an IMDb rating." />
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("Watch next")}</h3>
          <p className="mb-2 text-xs text-[#6f675b]">{t("From your watchlist, highest IMDb rating first")}</p>
          {a.next.length ? (
            <ul>
              {a.next.map((x) => (
                <MiniRow key={x.id} t={x} right={x.imdb_rating != null ? <span className="text-[#3b352d]">IMDb {x.imdb_rating.toFixed(1)}</span> : null} />
              ))}
            </ul>
          ) : (
            <Empty text="Mark titles as “Plan to watch” to build your watchlist." />
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("New seasons out")}</h3>
          <p className="mb-2 text-xs text-[#6f675b]">{t("Series with seasons you haven't watched yet")}</p>
          {a.behind.length ? (
            <ul>
              {a.behind.map((x) => (
                <MiniRow
                  key={x.id}
                  t={x}
                  right={
                    <span className="text-[#3b352d]">
                      {x.watched_seasons} / {x.seasons} <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] font-medium text-sky-800">{t("+{n} new", { n: newSeasons(x) })}</span>
                    </span>
                  }
                />
              ))}
            </ul>
          ) : (
            <Empty text="All caught up — or add seasons watched to your series." />
          )}
        </div>
        <div className={card}>
          <h3 className="text-sm font-semibold text-[#1f1c17]">{t("Coming soon")}</h3>
          <p className="mb-2 text-xs text-[#6f675b]">{t("Next episodes and premieres of what you follow or plan to watch")}</p>
          {a.upcoming.length ? (
            <ul>
              {a.upcoming.map((x) => {
                const days = Math.round((Date.parse(x.next_air_date) - Date.parse(today)) / 86_400_000);
                return (
                  <MiniRow
                    key={x.id}
                    t={x}
                    right={
                      <>
                        <span className="text-[#3b352d]">
                          {x.next_episode || t("Premiere")} · {new Date(x.next_air_date).toLocaleDateString(locale, { day: "numeric", month: "short" })}
                        </span>
                        <span className="block text-[11px] text-[#8f8676]">
                          {days === 0 ? t("today") : days === 1 ? t("tomorrow") : t("in {n} days", { n: days })}
                        </span>
                      </>
                    }
                  />
                );
              })}
            </ul>
          ) : (
            <Empty text="Nothing announced yet. Dates come from TMDB and refresh daily." />
          )}
        </div>
      </div>
    </section>
  );
}
