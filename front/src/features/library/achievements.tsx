"use client";

import { useMemo } from "react";
import { useBookSeries, type BookSeries } from "@/features/library/series";
import type { LibraryItem } from "@/features/library/types";
import { AchievementsCard, grade, mostCommon, type Achievement, type AchievementDef } from "@/features/shared/achievements";
import { useLibrary } from "@/state/library-store";

export const LIBRARY_GROUPS = ["Books", "Pages", "Variety", "Scores", "Authors", "Book series"] as const;
type Group = (typeof LIBRARY_GROUPS)[number];

type Ctx = { items: LibraryItem[]; read: LibraryItem[]; started: LibraryItem[]; series: BookSeries[] };

const count = (list: LibraryItem[], keep: (t: LibraryItem) => boolean) => ({ n: list.filter(keep).length });
const finishYear = (t: LibraryItem) => (Number(t.finish_date.slice(0, 4)) > 1900 ? t.finish_date.slice(0, 4) : "");

/** The best year by `value`, with the year as the detail. */
function bestYear(read: LibraryItem[], value: (t: LibraryItem) => number): { n: number; detail?: string } {
  const m = new Map<string, number>();
  for (const t of read) if (finishYear(t)) m.set(finishYear(t), (m.get(finishYear(t)) ?? 0) + value(t));
  let best: [string, number] | null = null;
  for (const e of m) if (!best || e[1] > best[1]) best = e;
  return best ? { n: best[1], detail: best[0] } : { n: 0 };
}

/** Longest run of consecutive years with at least one book finished. */
function longestStreak(read: LibraryItem[]): { n: number; detail?: string } {
  const years = [...new Set(read.map(finishYear).filter(Boolean).map(Number))].sort((a, b) => a - b);
  let best = 0;
  let bestEnd = 0;
  let run = 0;
  years.forEach((y, i) => {
    run = i > 0 && y === years[i - 1] + 1 ? run + 1 : 1;
    if (run > best) [best, bestEnd] = [run, y];
  });
  return best ? { n: best, detail: best > 1 ? `${bestEnd - best + 1}–${bestEnd}` : String(bestEnd) } : { n: 0 };
}

const DEFS: (AchievementDef<Ctx> & { group: Group })[] = [
  // Books
  { id: "read", group: "Books", label: "Books read", hint: "Everything marked read", tiers: [25, 75, 150], value: (c) => ({ n: c.read.length }) },
  { id: "year", group: "Books", label: "Books in one year", hint: "Your best year by books finished", tiers: [12, 24, 52], value: (c) => bestYear(c.read, () => 1) },
  { id: "streak", group: "Books", label: "Years in a row with a book", hint: "Consecutive years with at least one book finished", tiers: [3, 5, 10], value: (c) => longestStreak(c.read) },
  { id: "comics", group: "Books", label: "Comics and manga read", hint: "Comics and manga marked read", tiers: [5, 25, 75], value: (c) => count(c.read, (t) => t.kind === "comic" || t.kind === "manga") },
  // Pages
  { id: "pages", group: "Pages", label: "Pages read", hint: "Pages of the books you've read (where the page count is known)", tiers: [5000, 20000, 50000], value: (c) => ({ n: c.read.reduce((s, t) => s + (t.pages ?? 0), 0) }) },
  { id: "pagesYear", group: "Pages", label: "Pages in one year", hint: "Your best year by pages read", tiers: [3000, 8000, 15000], value: (c) => bestYear(c.read, (t) => t.pages ?? 0) },
  { id: "long", group: "Pages", label: "Books over 500 pages", hint: "Long reads you finished", tiers: [3, 10, 25], value: (c) => count(c.read, (t) => (t.pages ?? 0) > 500) },
  // Variety
  { id: "genres", group: "Variety", label: "Genres covered", hint: "Different genres among what you've read", tiers: [5, 12, 20], value: (c) => ({ n: new Set(c.started.flatMap((t) => t.genres)).size }) },
  {
    id: "decades",
    group: "Variety",
    label: "Decades covered",
    hint: "Different decades of first publication among what you've read",
    tiers: [4, 7, 10],
    value: (c) => ({ n: new Set(c.started.filter((t) => t.year).map((t) => Math.floor(t.year! / 10))).size }),
  },
  { id: "classics", group: "Variety", label: "Published before 1950", hint: "Books first published before 1950", tiers: [3, 10, 25], value: (c) => count(c.started, (t) => t.year != null && t.year < 1950) },
  // Scores
  { id: "scored", group: "Scores", label: "Books scored", hint: "Books with your score", tiers: [25, 75, 150], value: (c) => count(c.items, (t) => t.score != null) },
  { id: "fives", group: "Scores", label: "Five-star books", hint: "Books you gave ★ 5", tiers: [5, 15, 40], value: (c) => count(c.items, (t) => t.score != null && t.score >= 5) },
  {
    id: "gems",
    group: "Scores",
    label: "Scored 1★ above readers",
    hint: "Books you rate at least a star higher than the catalogue's readers",
    tiers: [3, 10, 25],
    value: (c) => count(c.items, (t) => t.score != null && t.source_rating != null && t.score - t.source_rating >= 1),
  },
  { id: "recommended", group: "Scores", label: "Books recommended", hint: "Books you ticked ✓", tiers: [5, 20, 50], value: (c) => count(c.items, (t) => t.recommended) },
  // Authors
  { id: "authors", group: "Authors", label: "Authors read", hint: "Different authors among what you've read", tiers: [10, 30, 75], value: (c) => ({ n: new Set(c.read.flatMap((t) => t.authors.slice(0, 1))).size }) },
  { id: "oneAuthor", group: "Authors", label: "Books by one author", hint: "Most books read by a single author", tiers: [3, 6, 10], value: (c) => mostCommon(c.read, (t) => t.authors.slice(0, 1)) },
  // Series
  { id: "series", group: "Book series", label: "Series complete", hint: "Every book of a series read", tiers: [1, 3, 10], value: (c) => ({ n: c.series.filter((s) => s.tier === "gold").length }) },
  { id: "seriesBooks", group: "Book series", label: "Series books read", hint: "Books of Wikidata series you've read", tiers: [5, 20, 50], value: (c) => ({ n: c.series.reduce((s, x) => s + x.read, 0) }) },
];

export function useLibraryAchievements(): { achievements: Achievement[]; isLoading: boolean } {
  const { items } = useLibrary();
  const { series, isLoading } = useBookSeries();
  const achievements = useMemo(() => {
    const ctx: Ctx = { items, read: items.filter((t) => t.status === "read"), started: items.filter((t) => t.status !== "planned"), series };
    return DEFS.map((d) => grade(d, ctx));
  }, [items, series]);
  return { achievements, isLoading };
}

/** Overview card: medal counts and the three achievements closest to their next medal. */
export function LibraryAchievementsCard() {
  const { achievements } = useLibraryAchievements();
  return <AchievementsCard achievements={achievements} href="/library/achievements" />;
}
