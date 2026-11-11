"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AddToWatchlist } from "@/features/cinema/add-to-watchlist";
import { useFranchises, type Franchise } from "@/features/cinema/franchises";
import { cinemaKindMeta } from "@/features/cinema/nav";
import type { CinemaTitle } from "@/features/cinema/types";
import { Poster } from "@/features/cinema/ui";
import { useLocale, useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

export type UpcomingKind = "season" | "episode" | "premiere" | "franchise";

export type Upcoming = {
  key: string;
  date: string; // ISO day
  kind: UpcomingKind;
  title: string;
  poster: string;
  /** "S3E1" for series; the franchise's name for a franchise film. */
  detail: string;
  /** Your title, when it's in your library. */
  mine: CinemaTitle | null;
  /** A franchise film you don't have yet: can be added to the watchlist. */
  tmdbId: number | null;
  animation: boolean;
};

/** "S3E1" → 3 when it opens a season, else null. */
const seasonOpening = (ep: string) => {
  const m = /^S(\d+)E0*1$/i.exec(ep.trim());
  return m ? Number(m[1]) : null;
};

/**
 * What's coming: the next episode or season of series you watch or finished (not dropped), premieres of films on your
 * watchlist, and unreleased films of franchises you've started. `justOut`: franchise films out lately you haven't seen.
 */
export function collectUpcoming(items: CinemaTitle[], franchises: Franchise[], today: string): { soon: Upcoming[]; justOut: Upcoming[] } {
  const soon: Upcoming[] = [];
  const justOut: Upcoming[] = [];
  const mineByTmdb = new Set(items.filter((t) => t.tmdb_id).map((t) => t.tmdb_id));

  for (const t of items) {
    if (!t.next_air_date || t.next_air_date < today || t.status === "dropped") continue;
    if (t.tmdb_media === "tv") {
      const opens = seasonOpening(t.next_episode);
      // A finished series matters again only when a new season starts, not for its every episode.
      if (t.status === "watched" && opens == null) continue;
      soon.push({ key: t.id, date: t.next_air_date, kind: opens != null ? "season" : "episode", title: t.title, poster: t.poster, detail: t.next_episode, mine: t, tmdbId: null, animation: false });
    } else if (t.status === "planned") {
      soon.push({ key: t.id, date: t.next_air_date, kind: "premiere", title: t.title, poster: t.poster, detail: "", mine: t, tmdbId: null, animation: false });
    }
  }

  const monthsAgo = new Date(`${today}T00:00:00Z`);
  monthsAgo.setUTCDate(monthsAgo.getUTCDate() - 60);
  const since = monthsAgo.toISOString().slice(0, 10);
  for (const f of franchises) {
    if (!f.watched) continue; // a franchise you haven't started isn't news to you
    for (const p of f.parts) {
      if (!p.release_date || mineByTmdb.has(p.tmdb_id)) continue;
      const entry: Upcoming = { key: `f${p.tmdb_id}`, date: p.release_date, kind: "franchise", title: p.title, poster: p.poster, detail: f.name, mine: null, tmdbId: p.tmdb_id, animation: p.animation };
      if (p.release_date >= today) soon.push(entry);
      else if (p.release_date >= since) justOut.push(entry);
    }
  }
  const byDate = (a: Upcoming, b: Upcoming) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title);
  return { soon: soon.sort(byDate), justOut: justOut.sort(byDate).reverse() };
}

export function useUpcoming() {
  const { items, isLoaded } = useCinema();
  const { franchises, isLoading } = useFranchises();
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const lists = useMemo(() => collectUpcoming(items, franchises, today), [items, franchises, today]);
  return { ...lists, today, isLoading: !isLoaded || isLoading };
}

const KIND_LABEL: Record<UpcomingKind, string> = {
  season: "New season",
  episode: "Next episode",
  premiere: "Premiere",
  franchise: "Franchise",
};

const KIND_TONE: Record<UpcomingKind, string> = {
  season: "bg-violet-50 text-violet-800",
  episode: "bg-sky-50 text-sky-800",
  premiere: "bg-amber-50 text-amber-800",
  franchise: "bg-emerald-50 text-emerald-800",
};

function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function UpcomingRow({ u, today, compact = false }: { u: Upcoming; today: string; compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const days = daysUntil(u.date, today);
  const when =
    days === 0 ? t("Today") : days === 1 ? t("Tomorrow") : days > 1 ? t("in {n} days", { n: days }) : t("{n} days ago", { n: -days });
  const day = new Date(`${u.date}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", weekday: compact ? undefined : "short", timeZone: "UTC" });
  const season = u.kind === "season" ? seasonOpening(u.detail) : null;
  const what =
    u.kind === "season" ? t("Season {n}", { n: season ?? "" }) : u.kind === "episode" ? u.detail : u.kind === "franchise" ? u.detail : t("On your watchlist");
  const href = u.mine ? `/cinematography/${cinemaKindMeta(u.mine.kind).slug}` : "/cinematography/franchises";

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="w-14 shrink-0 text-center">
        <p className="text-xs font-semibold text-[#1f1c17]">{day}</p>
        <p className={`text-[11px] ${days >= 0 && days <= 7 ? "font-semibold text-emerald-700" : "text-[#8f8676]"}`}>{when}</p>
      </div>
      <Link href={href} className="shrink-0">
        <Poster src={u.poster} title={u.title} className="aspect-[2/3] w-9 text-[10px]" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} className="block truncate text-sm font-medium text-[#1f1c17] hover:underline">
          {u.title}
        </Link>
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#6f675b]">
          <span className={`rounded-full px-1.5 py-px font-semibold ${KIND_TONE[u.kind]}`}>{t(KIND_LABEL[u.kind])}</span>
          <span className="truncate">{what}</span>
        </p>
      </div>
      {!compact && u.tmdbId != null ? <AddToWatchlist tmdbId={u.tmdbId} animation={u.animation} /> : null}
    </li>
  );
}

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";

/** The overview's short version: the next few releases, with a link to the whole list. */
export function UpcomingCard() {
  const t = useT();
  const { soon, today, isLoading } = useUpcoming();
  if (isLoading || !soon.length) return null;
  return (
    <section className={card} aria-labelledby="upcoming-card-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="upcoming-card-title" className="text-sm font-semibold text-[#1f1c17]">
          {t("Coming up")}
        </h2>
        <Link href="/cinematography/upcoming" className="text-xs text-[#6f675b] hover:text-[#1f1c17]">
          {t("All {n} →", { n: soon.length })}
        </Link>
      </div>
      <ul className="mt-1 divide-y divide-black/5">
        {soon.slice(0, 5).map((u) => (
          <UpcomingRow key={u.key} u={u} today={today} compact />
        ))}
      </ul>
    </section>
  );
}
