"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useFranchises, type Franchise } from "@/features/cinema/franchises";
import { isSeries, watchedMinutes, type CinemaTitle } from "@/features/cinema/types";
import { useLocale, useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

export type Medal = "none" | "bronze" | "silver" | "gold";

export const MEDALS: Record<Medal, { label: string; ring: string; badge: string }> = {
  gold: { label: "Gold", ring: "#d4a017", badge: "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950" },
  silver: { label: "Silver", ring: "#8f9bab", badge: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900" },
  bronze: { label: "Bronze", ring: "#b8733a", badge: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-950" },
  none: { label: "Not yet", ring: "#cfc8bb", badge: "bg-[#ece6da] text-[#8f8676]" },
};

export const GROUPS = ["Titles", "Time", "Variety", "Scores", "People", "Franchises"] as const;
type Group = (typeof GROUPS)[number];

type Def = {
  id: string;
  group: Group;
  /** What is counted, as a plain label: "Titles watched". */
  label: string;
  hint: string;
  /** Bronze, silver, gold thresholds. */
  tiers: [number, number, number];
  value: (c: Ctx) => { n: number; detail?: string };
};

type Ctx = { items: CinemaTitle[]; watched: CinemaTitle[]; seen: CinemaTitle[]; franchises: Franchise[] };

export type Achievement = Omit<Def, "value"> & {
  n: number;
  detail?: string;
  medal: Medal;
  /** Next threshold to reach, or null when gold. */
  next: number | null;
  /** 0–1 progress from the current medal's threshold to the next one. */
  progress: number;
};

/** Seasons of a series you've watched: the season you're on, or all of them once it's marked watched. */
function seasonsWatched(t: CinemaTitle): number {
  if (!isSeries(t.kind) || t.status === "planned") return 0;
  return t.watched_seasons ?? (t.status === "watched" ? (t.seasons ?? t.season_episodes.length) : 0);
}

function episodesWatched(t: CinemaTitle): number {
  return t.season_episodes.slice(0, seasonsWatched(t)).reduce((s, n) => s + n, 0);
}

/** The name that appears most across `pick(t)`, and how often. */
function mostCommon(list: CinemaTitle[], pick: (t: CinemaTitle) => string[]): { n: number; detail?: string } {
  const m = new Map<string, number>();
  for (const t of list) for (const k of new Set(pick(t))) m.set(k, (m.get(k) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const e of m) if (!best || e[1] > best[1]) best = e;
  return best ? { n: best[1], detail: best[0] } : { n: 0 };
}

const count = (list: CinemaTitle[], keep: (t: CinemaTitle) => boolean) => ({ n: list.filter(keep).length });

const DEFS: Def[] = [
  // Titles
  { id: "titles", group: "Titles", label: "Titles watched", hint: "Everything marked watched", tiers: [100, 300, 600], value: (c) => ({ n: c.watched.length }) },
  { id: "films", group: "Titles", label: "Films watched", hint: "Feature films marked watched", tiers: [100, 250, 500], value: (c) => count(c.watched, (t) => t.kind === "film") },
  { id: "series", group: "Titles", label: "Series finished", hint: "Series, animated series, anime and TV shows marked watched", tiers: [25, 75, 150], value: (c) => count(c.watched, (t) => isSeries(t.kind)) },
  { id: "anime", group: "Titles", label: "Anime watched", hint: "Anime marked watched", tiers: [10, 30, 75], value: (c) => count(c.watched, (t) => t.kind === "anime") },
  {
    id: "animation",
    group: "Titles",
    label: "Cartoons and animated series watched",
    hint: "Cartoons and animated series marked watched",
    tiers: [25, 75, 150],
    value: (c) => count(c.watched, (t) => t.kind === "cartoon" || t.kind === "animated_series"),
  },
  // Time
  {
    id: "hours",
    group: "Time",
    label: "Hours watched",
    hint: "Films' runtime plus the aired minutes of the seasons you've watched",
    tiers: [500, 1500, 3000],
    value: (c) => ({ n: Math.round(c.items.reduce((s, t) => s + watchedMinutes(t), 0) / 60) }),
  },
  { id: "seasons", group: "Time", label: "Seasons watched", hint: "Across all series", tiers: [50, 200, 400], value: (c) => ({ n: c.items.reduce((s, t) => s + seasonsWatched(t), 0) }) },
  { id: "episodes", group: "Time", label: "Episodes watched", hint: "Aired episodes of the seasons you've watched", tiers: [500, 2500, 5000], value: (c) => ({ n: c.items.reduce((s, t) => s + episodesWatched(t), 0) }) },
  // Variety
  {
    id: "decades",
    group: "Variety",
    label: "Decades covered",
    hint: "Different release decades among what you've seen",
    tiers: [5, 7, 9],
    value: (c) => ({ n: new Set(c.seen.filter((t) => t.year).map((t) => Math.floor(t.year! / 10))).size }),
  },
  { id: "genres", group: "Variety", label: "Genres covered", hint: "Different genres among what you've seen", tiers: [10, 18, 25], value: (c) => ({ n: new Set(c.seen.flatMap((t) => t.genres)).size }) },
  { id: "classics", group: "Variety", label: "Released before 1980", hint: "Titles you've seen from before 1980", tiers: [5, 20, 50], value: (c) => count(c.seen, (t) => t.year != null && t.year < 1980) },
  { id: "kinds", group: "Variety", label: "Types watched", hint: "Films, series, cartoons, animated series, anime and TV shows", tiers: [3, 5, 6], value: (c) => ({ n: new Set(c.seen.map((t) => t.kind)).size }) },
  // Scores
  { id: "scored", group: "Scores", label: "Titles scored", hint: "Titles with your score", tiers: [100, 300, 600], value: (c) => count(c.items, (t) => t.score != null) },
  { id: "tens", group: "Scores", label: "Scores of 10", hint: "Titles you gave a 10", tiers: [5, 20, 50], value: (c) => count(c.items, (t) => t.score != null && t.score >= 10) },
  {
    id: "gems",
    group: "Scores",
    label: "Scored 2+ above IMDb",
    hint: "Titles you rate at least 2 points higher than IMDb",
    tiers: [5, 15, 30],
    value: (c) => count(c.items, (t) => t.score != null && t.imdb_rating != null && t.score - t.imdb_rating >= 2),
  },
  { id: "imdb8", group: "Scores", label: "IMDb 8+ watched", hint: "Watched titles rated 8 or more on IMDb", tiers: [50, 150, 300], value: (c) => count(c.watched, (t) => (t.imdb_rating ?? 0) >= 8) },
  { id: "recommended", group: "Scores", label: "Titles recommended", hint: "Titles you ticked ✓", tiers: [25, 75, 150], value: (c) => count(c.items, (t) => t.recommended) },
  // People
  { id: "director", group: "People", label: "Films by one director", hint: "Most watched titles by a single director", tiers: [3, 6, 10], value: (c) => mostCommon(c.watched, (t) => t.directors) },
  { id: "actor", group: "People", label: "Titles with one actor", hint: "Most watched titles with a single actor", tiers: [5, 12, 20], value: (c) => mostCommon(c.watched, (t) => t.actors) },
  { id: "studio", group: "People", label: "Titles from one studio", hint: "Most titles you've seen from a single studio", tiers: [15, 40, 80], value: (c) => mostCommon(c.seen, (t) => t.studios) },
  // Franchises
  { id: "franchises", group: "Franchises", label: "Franchises complete", hint: "Every released film watched", tiers: [5, 20, 40], value: (c) => ({ n: c.franchises.filter((f) => f.tier === "gold").length }) },
  { id: "franchiseFilms", group: "Franchises", label: "Franchise films watched", hint: "Films of TMDB collections you've watched", tiers: [50, 150, 300], value: (c) => ({ n: c.franchises.reduce((s, f) => s + f.watched, 0) }) },
];

function grade(def: Def, ctx: Ctx): Achievement {
  const { n, detail } = def.value(ctx);
  const [b, s, g] = def.tiers;
  const medal: Medal = n >= g ? "gold" : n >= s ? "silver" : n >= b ? "bronze" : "none";
  const floor = medal === "gold" ? g : medal === "silver" ? s : medal === "bronze" ? b : 0;
  const next = medal === "gold" ? null : medal === "silver" ? g : medal === "bronze" ? s : b;
  return { id: def.id, group: def.group, label: def.label, hint: def.hint, tiers: def.tiers, n, detail, medal, next, progress: next == null ? 1 : Math.min(1, (n - floor) / (next - floor)) };
}

export function useAchievements(): { achievements: Achievement[]; isLoading: boolean } {
  const { items } = useCinema();
  const { franchises, isLoading } = useFranchises();
  const achievements = useMemo(() => {
    const ctx: Ctx = { items, watched: items.filter((t) => t.status === "watched"), seen: items.filter((t) => t.status !== "planned"), franchises };
    return DEFS.map((d) => grade(d, ctx));
  }, [items, franchises]);
  return { achievements, isLoading };
}

/** Closest to the next medal first. */
export const byNextMedal = (a: Achievement, b: Achievement) => b.progress - a.progress;

/** A ring of progress to the next medal, with the current count inside. */
export function MedalRing({ a, size = 72 }: { a: Achievement; size?: number }) {
  const t = useT();
  const locale = useLocale();
  const medal = MEDALS[a.medal];
  const stroke = 5;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const n = a.n >= 10_000 ? `${Math.round(a.n / 1000)}k` : a.n.toLocaleString(locale);
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={t(medal.label)}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efe9dc" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={a.medal === "gold" ? medal.ring : MEDALS[nextMedal(a.medal)].ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - a.progress)}
        />
      </svg>
      <span
        className={`flex items-center justify-center rounded-full font-semibold tabular-nums ${medal.badge}`}
        style={{ width: size - stroke * 2 - 8, height: size - stroke * 2 - 8, fontSize: size / 4.5 }}
      >
        {n}
      </span>
    </span>
  );
}

const nextMedal = (m: Medal): Medal => (m === "none" ? "bronze" : m === "bronze" ? "silver" : "gold");

// One string per medal: Ukrainian needs the medal's name in another case ("до срібла").
const NEXT_TEXT: Record<Medal, string> = {
  none: "",
  bronze: "{n} more for bronze",
  silver: "{n} more for silver",
  gold: "{n} more for gold",
};

/** "23 more for silver", or the gold note. */
export function useNextText() {
  const t = useT();
  const locale = useLocale();
  return (a: Achievement) =>
    a.next == null
      ? t("Gold reached")
      : t(NEXT_TEXT[nextMedal(a.medal)], { n: (a.next - a.n).toLocaleString(locale) });
}

/** Overview card: medal counts and the three achievements closest to their next medal. */
export function AchievementsCard() {
  const t = useT();
  const { achievements } = useAchievements();
  const nextText = useNextText();
  const medals = (m: Medal) => achievements.filter((a) => a.medal === m).length;
  const closest = achievements.filter((a) => a.next != null && a.n > 0).sort(byNextMedal).slice(0, 3);

  return (
    <section className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]" aria-labelledby="achievements-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="achievements-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("Achievements")}
          </h2>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {(["gold", "silver", "bronze"] as const).map((m) => (
              <span key={m} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${MEDALS[m].badge}`}>
                {t(MEDALS[m].label)} · {medals(m)}
              </span>
            ))}
            <span className="text-[11px] text-[#8f8676]">{t("of {n} achievements", { n: achievements.length })}</span>
          </p>
        </div>
        <Link href="/cinematography/achievements" className="text-xs text-[#6f675b] hover:text-[#1f1c17]">
          {t("All achievements →")}
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {closest.map((a) => (
          <li key={a.id} className="flex items-center gap-3">
            <MedalRing a={a} size={56} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#1f1c17]">{t(a.label)}</span>
              <span className="block text-[11px] text-[#6f675b]">{nextText(a)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
