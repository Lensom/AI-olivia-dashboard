"use client";

import { useMemo } from "react";
import { useFranchises, type Franchise } from "@/features/cinema/franchises";
import { isSeries, watchedMinutes, type CinemaTitle } from "@/features/cinema/types";
import { AchievementsCard as Card, grade, mostCommon, type Achievement, type AchievementDef } from "@/features/shared/achievements";
import { useCinema } from "@/state/cinema-store";

export const GROUPS = ["Titles", "Time", "Variety", "Scores", "People", "Franchises"] as const;
type Group = (typeof GROUPS)[number];

type Ctx = { items: CinemaTitle[]; watched: CinemaTitle[]; seen: CinemaTitle[]; franchises: Franchise[] };

/** Seasons of a series you've watched: the season you're on, or all of them once it's marked watched. */
function seasonsWatched(t: CinemaTitle): number {
  if (!isSeries(t.kind) || t.status === "planned") return 0;
  return t.watched_seasons ?? (t.status === "watched" ? (t.seasons ?? t.season_episodes.length) : 0);
}

function episodesWatched(t: CinemaTitle): number {
  return t.season_episodes.slice(0, seasonsWatched(t)).reduce((s, n) => s + n, 0);
}

const count = (list: CinemaTitle[], keep: (t: CinemaTitle) => boolean) => ({ n: list.filter(keep).length });

const DEFS: (AchievementDef<Ctx> & { group: Group })[] = [
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

export function useAchievements(): { achievements: Achievement[]; isLoading: boolean } {
  const { items } = useCinema();
  const { franchises, isLoading } = useFranchises();
  const achievements = useMemo(() => {
    const ctx: Ctx = { items, watched: items.filter((t) => t.status === "watched"), seen: items.filter((t) => t.status !== "planned"), franchises };
    return DEFS.map((d) => grade(d, ctx));
  }, [items, franchises]);
  return { achievements, isLoading };
}

/** Overview card: medal counts and the three achievements closest to their next medal. */
export function AchievementsCard() {
  const { achievements } = useAchievements();
  return <Card achievements={achievements} href="/cinematography/achievements" />;
}
