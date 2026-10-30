"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { titleFromTmdb } from "@/features/cinema/add-from-tmdb";
import { errorText } from "@/features/cinema/title-dialog";
import type { CinemaCollection, CinemaTitle } from "@/features/cinema/types";
import { Poster } from "@/features/cinema/ui";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

export type FranchiseTier = "locked" | "bronze" | "silver" | "gold";

export const TIERS: Record<FranchiseTier, { label: string; ring: string; badge: string; card: string }> = {
  gold: {
    label: "Complete",
    ring: "#d4a017",
    badge: "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950",
    card: "border-amber-300 bg-gradient-to-br from-amber-50 to-white",
  },
  silver: { label: "Halfway there", ring: "#8f9bab", badge: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900", card: "border-black/5 bg-white/90" },
  bronze: { label: "Started", ring: "#b8733a", badge: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-950", card: "border-black/5 bg-white/90" },
  locked: { label: "Not started", ring: "#cfc8bb", badge: "bg-[#ece6da] text-[#8f8676]", card: "border-dashed border-black/10 bg-white/60" },
};

/** "Complete N franchises" goals, shown one at a time as the next thing to unlock. */
export const GOALS = [1, 3, 5, 10, 15, 25, 50, 100];

export type FranchisePart = CinemaCollection["parts"][number] & { mine: CinemaTitle | null; released: boolean };

export type Franchise = {
  id: number;
  name: string;
  poster: string;
  parts: FranchisePart[];
  released: number;
  watched: number;
  /** Released films not watched yet. */
  left: number;
  tier: FranchiseTier;
  /** Your average score over the films you've watched. */
  avgScore: number | null;
  /** Year you watched the last film of a complete franchise (when known). */
  completedYear: number | null;
  /** Next announced film, for a franchise that isn't over. */
  nextPart: FranchisePart | null;
};

function tierOf(watched: number, released: number): FranchiseTier {
  if (!watched) return "locked";
  if (watched >= released) return "gold";
  return watched * 2 >= released ? "silver" : "bronze";
}

/** TMDB collections of the films in your library, with your progress through each. */
export function useFranchises(): { franchises: Franchise[]; isLoading: boolean } {
  const { token } = useAuth();
  const { items } = useCinema();
  const [collections, setCollections] = useState<CinemaCollection[] | null>(null);
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  const idsKey = useMemo(
    () => [...new Set(items.map((x) => x.collection_id).filter((x): x is number => x != null))].sort((a, b) => a - b).join(","),
    [items],
  );

  useEffect(() => {
    if (!token || !idsKey) return;
    let alive = true;
    apiFetch<CinemaCollection[]>("/cinema/collections", { token, method: "POST", body: JSON.stringify(idsKey.split(",").map(Number)) })
      .then((c) => alive && setCollections(c))
      .catch(() => alive && setCollections([]));
    return () => {
      alive = false;
    };
  }, [token, idsKey]);

  const franchises = useMemo(() => {
    const byId = new Map(items.filter((x) => x.tmdb_media === "movie" && x.tmdb_id).map((x) => [x.tmdb_id!, x]));
    return (collections ?? [])
      .map((c): Franchise => {
        const parts = c.parts.map((p) => ({ ...p, mine: byId.get(p.tmdb_id) ?? null, released: !!p.release_date && p.release_date <= today }));
        const released = parts.filter((p) => p.released);
        const seen = released.filter((p) => p.mine?.status === "watched");
        const scores = seen.map((p) => p.mine!.score).filter((s): s is number => s != null);
        const tier = tierOf(seen.length, released.length);
        const years = seen.map((p) => p.mine!.view_year).filter((y): y is number => y != null);
        return {
          id: c.id,
          name: c.name,
          poster: c.poster || parts.find((p) => p.poster)?.poster || "",
          parts,
          released: released.length,
          watched: seen.length,
          left: released.length - seen.length,
          tier,
          avgScore: scores.length ? scores.reduce((s, n) => s + n, 0) / scores.length : null,
          completedYear: tier === "gold" && years.length ? Math.max(...years) : null,
          nextPart: parts.find((p) => !p.released) ?? null,
        };
      })
      .filter((f) => f.released > 1 && f.parts.some((p) => p.mine));
  }, [collections, items, today]);

  return { franchises, isLoading: idsKey !== "" && collections === null };
}

/** Closest to complete first (fewest films left), then the biggest. */
export const byProgress = (a: Franchise, b: Franchise) => a.left - b.left || b.watched / b.released - a.watched / a.released || b.released - a.released;

/** The collection poster in a progress ring, with the tier medal on it. */
export function FranchiseBadge({ f, size = 84 }: { f: Franchise; size?: number }) {
  const t = useT();
  const tier = TIERS[f.tier];
  const stroke = 5;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const inner = size - stroke * 2 - 6;
  return (
    <span className="relative inline-block shrink-0" style={{ width: size, height: size }} title={t(tier.label)}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efe9dc" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tier.ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - f.watched / f.released)}
        />
      </svg>
      <span className="absolute overflow-hidden rounded-full" style={{ inset: stroke + 3, width: inner, height: inner }}>
        <Poster src={f.poster} title={f.name} className={`h-full w-full rounded-full ${f.tier === "locked" ? "opacity-50 grayscale" : ""}`} />
      </span>
      <span
        className={`absolute -bottom-0.5 -right-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shadow ring-2 ring-white ${tier.badge}`}
        aria-hidden
      >
        {f.tier === "gold" ? "★" : f.tier === "locked" ? "🔒" : `${Math.round((f.watched / f.released) * 100)}`}
      </span>
    </span>
  );
}

/** Add a film of a franchise to the watchlist. */
export function usePlanPart() {
  const t = useT();
  const { token } = useAuth();
  const { update } = useCinema();
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function plan(p: FranchisePart) {
    setAdding(p.tmdb_id);
    setError(null);
    try {
      const title = await titleFromTmdb(token, "movie", p.tmdb_id, p.animation ? "cartoon" : "film");
      await update((list) => [title, ...list]);
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
    } finally {
      setAdding(null);
    }
  }
  return { plan, adding, error };
}

/** The films of a franchise as a sticker album: watched in colour, the rest greyed with "+ Plan". */
export function PartsStrip({ f, plan, adding, size = 64 }: { f: Franchise; plan: (p: FranchisePart) => void; adding: number | null; size?: number }) {
  const t = useT();
  return (
    <ul className="flex gap-2 overflow-x-auto pb-1">
      {f.parts.map((p) => {
        const status = p.mine?.status;
        return (
          <li key={p.tmdb_id} className="shrink-0" style={{ width: size }}>
            <span className="relative block">
              <Poster src={p.poster} title={p.title} className={`aspect-[2/3] w-full ${status === "watched" ? "" : "opacity-40 grayscale"}`} />
              {status === "watched" ? (
                <span className="absolute right-1 top-1 rounded bg-emerald-600 px-1 text-[10px] font-semibold text-white">✓</span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-[11px] text-[#3b352d]" title={p.title}>
              {p.title}
            </span>
            <span className="block text-[10px] text-[#8f8676]">
              {!p.released
                ? (p.year ?? t("TBA"))
                : status === "watched"
                  ? p.mine?.score != null
                    ? `★ ${p.mine.score}`
                    : p.year
                  : status === "planned"
                    ? t("Planned")
                    : status === "watching"
                      ? t("Watching")
                      : status === "dropped"
                        ? t("Dropped")
                        : p.year}
            </span>
            {!p.mine && p.released ? (
              <button
                type="button"
                onClick={() => plan(p)}
                disabled={adding !== null}
                className="mt-0.5 rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-medium text-[#3b352d] hover:bg-[#faf8f2] disabled:opacity-50"
                title={t("Add to your watchlist")}
              >
                {adding === p.tmdb_id ? "…" : `+ ${t("Plan")}`}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Overview card: how many franchises are complete and the ones closest to it, linking to the Franchises page. */
export function Franchises() {
  const t = useT();
  const { franchises } = useFranchises();
  const { plan, adding, error } = usePlanPart();
  if (!franchises.length) return null;
  const done = franchises.filter((f) => f.tier === "gold").length;
  const closest = franchises.filter((f) => f.tier !== "gold").sort(byProgress).slice(0, 3);

  return (
    <section className={card} aria-labelledby="franchises-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="franchises-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("Franchises")}
          </h2>
          <p className="text-xs text-[#6f675b]">{t("{done} of {n} complete · closest to finishing:", { done, n: franchises.length })}</p>
        </div>
        <Link href="/cinematography/franchises" className="text-xs text-[#6f675b] hover:text-[#1f1c17]">
          {t("All franchises →")}
        </Link>
      </div>
      {error ? <p className="mb-2 text-xs text-rose-700">{error}</p> : null}
      {closest.length ? (
        <ul className="space-y-4">
          {closest.map((f) => (
            <li key={f.id} className="flex gap-4">
              <FranchiseBadge f={f} size={64} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium text-[#1f1c17]">{f.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[#6f675b]">{t("{w} / {n} watched", { w: f.watched, n: f.released })}</span>
                </p>
                <div className="mt-1.5">
                  <PartsStrip f={f} plan={(p) => void plan(p)} adding={adding} size={48} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs font-medium text-amber-700">★ {t("Every franchise you've started is complete.")}</p>
      )}
    </section>
  );
}
