"use client";

import { useEffect, useMemo, useState } from "react";
import { AddToWatchlist } from "@/features/cinema/add-to-watchlist";
import { isSeries, type CinemaPerson, type CinemaTitle } from "@/features/cinema/types";
import { Poster, ScoreBadge } from "@/features/cinema/ui";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const SHOWN = 12;

type Role = "director" | "actor";
type Fav = { name: string; titles: CinemaTitle[]; avg: number | null };

/**
 * Your favourite directors and actors, by your own scores: at least two titles you've watched, best average first.
 * Series' "directors" are their creators, so directors come from films only.
 */
function favourites(items: CinemaTitle[], role: Role): Fav[] {
  const groups = new Map<string, CinemaTitle[]>();
  for (const t of items) {
    if (t.status !== "watched") continue;
    const names = role === "director" ? (isSeries(t.kind) ? [] : t.directors) : t.actors;
    for (const n of new Set(names)) groups.set(n, [...(groups.get(n) ?? []), t]);
  }
  return [...groups]
    .filter(([, list]) => list.length >= 2)
    .map(([name, titles]): Fav => {
      const scored = titles.filter((t) => t.score != null);
      return { name, titles: [...titles].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)), avg: scored.length ? scored.reduce((s, t) => s + (t.score ?? 0), 0) / scored.length : null };
    })
    .sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0) || b.titles.length - a.titles.length)
    .slice(0, SHOWN);
}

function PersonCard({ fav, person, loading, role }: { fav: Fav; person: CinemaPerson | undefined; loading: boolean; role: Role }) {
  const t = useT();
  const { items } = useCinema();
  const [open, setOpen] = useState(false);
  const watched = new Set(items.filter((x) => x.status === "watched" && x.tmdb_media === "movie").map((x) => x.tmdb_id));
  // Best regarded first: what you'd most likely want to catch up on.
  const unseen = (person?.films ?? []).filter((f) => !watched.has(f.tmdb_id)).sort((a, b) => (b.vote_average ?? 0) * Math.log10(b.vote_count + 10) - (a.vote_average ?? 0) * Math.log10(a.vote_count + 10));

  return (
    <li className={card}>
      <div className="flex items-start gap-3">
        {person?.profile ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB images, as the posters elsewhere
          <img src={person.profile} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#f1ece2] text-lg font-semibold text-[#8f8676]">{fav.name.slice(0, 1)}</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[#1f1c17]">{fav.name}</p>
          <p className="text-xs text-[#6f675b]">
            {t("{n} titles", { n: fav.titles.length })}
            {fav.avg != null ? ` · ${t("avg {v}", { v: fav.avg.toFixed(1) })}` : ""}
          </p>
        </div>
      </div>
      <ul className="mt-3 flex gap-1.5">
        {fav.titles.slice(0, 5).map((x) => (
          <li key={x.id} className="relative w-12 shrink-0" title={x.title}>
            <Poster src={x.poster} title={x.title} className="aspect-[2/3] w-12 text-[9px]" />
            <span className="absolute -right-1 -top-1">
              <ScoreBadge score={x.score} />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 border-t border-black/5 pt-2">
        {loading ? (
          <p className="text-xs text-[#8f8676]">{t("Looking up their films…")}</p>
        ) : !person ? (
          <p className="text-xs text-[#8f8676]">{t("Not found on TMDB.")}</p>
        ) : !unseen.length ? (
          <p className="text-xs font-medium text-emerald-700">{role === "director" ? t("You've seen all their films.") : t("You've seen all their notable films.")}</p>
        ) : (
          <>
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="text-xs font-semibold text-[#2a78d6] hover:underline">
              {t("{n} films you haven't seen", { n: unseen.length })} {open ? "▴" : "▾"}
            </button>
            {open ? (
              <ul className="mt-2 space-y-1.5">
                {unseen.slice(0, 10).map((f) => (
                  <li key={f.tmdb_id} className="flex items-center gap-2">
                    <Poster src={f.poster} title={f.title} className="aspect-[2/3] w-8 shrink-0 text-[8px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-[#1f1c17]">{f.title}</span>
                      <span className="block text-[11px] text-[#8f8676]">{[f.year, f.vote_average ? `TMDB ${f.vote_average.toFixed(1)}` : ""].filter(Boolean).join(" · ")}</span>
                    </span>
                    <AddToWatchlist tmdbId={f.tmdb_id} animation={f.animation} />
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

export default function CinemaPeoplePage() {
  const t = useT();
  const { token } = useAuth();
  const { items, isLoaded, loadError, tmdbEnabled } = useCinema();
  const [role, setRole] = useState<Role>("director");
  const favs = useMemo(() => favourites(items, role), [items, role]);
  const namesKey = favs.map((f) => f.name).join("\n");
  const [loaded, setLoaded] = useState<{ key: string; people: CinemaPerson[] } | null>(null);
  const key = `${role}|${namesKey}`;

  useEffect(() => {
    if (!token || !namesKey || !tmdbEnabled) return;
    let alive = true;
    apiFetch<CinemaPerson[]>("/cinema/people", { token, method: "POST", body: JSON.stringify({ names: namesKey.split("\n"), role }) })
      .then((people) => alive && setLoaded({ key, people }))
      .catch(() => alive && setLoaded({ key, people: [] }));
    return () => {
      alive = false;
    };
  }, [token, namesKey, role, key, tmdbEnabled]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;

  const loading = tmdbEnabled && loaded?.key !== key;
  const byName = new Map((loaded?.key === key ? loaded.people : []).map((p) => [p.name, p]));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-[#655d51]">
          {t("The people behind what you watch, ranked by your own scores (two titles or more), and what of theirs you haven't seen yet.")}
        </p>
        <span className="inline-flex rounded-full border border-black/10 bg-white p-0.5">
          {(["director", "actor"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRole(r)}
              aria-pressed={role === r}
              className={`rounded-full px-3 py-1 text-xs font-medium ${role === r ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
            >
              {t(r === "director" ? "Directors" : "Actors")}
            </button>
          ))}
        </span>
      </div>
      {!favs.length ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`}>{t("Once you've watched two titles by the same person, they show up here.")}</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {favs.map((f) => (
            <PersonCard key={`${role}-${f.name}`} fav={f} person={byName.get(f.name)} loading={loading} role={role} />
          ))}
        </ul>
      )}
    </div>
  );
}
