"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { newlyWatchedUnrated, type CinemaAiring, type CinemaList, type CinemaTitle, type CinemaYear } from "@/features/cinema/types";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./auth-store";

type CinemaDoc = { items: CinemaTitle[]; language: string; lists: CinemaList[]; years?: Record<string, CinemaYear>; hidden_years?: number[]; updated_at: string | null; tmdb_enabled: boolean };
type Saved = { items: CinemaTitle[]; language: string; lists: CinemaList[] };

type CinemaStore = {
  items: CinemaTitle[];
  lists: CinemaList[];
  language: string;
  tmdbEnabled: boolean;
  isLoaded: boolean;
  loadError: string | null;
  /** Applies `change` to the latest list and saves it right away; reverts and throws if the save fails. */
  update: (change: (items: CinemaTitle[]) => CinemaTitle[]) => Promise<void>;
  /** Same as `update`, for the Tops lists. */
  updateLists: (change: (lists: CinemaList[]) => CinemaList[]) => Promise<void>;
  setLanguage: (language: string) => Promise<void>;
  /** Titles just marked watched without a score, waiting for "how was it?" (oldest first). */
  toRate: string[];
  dismissRate: (id: string) => void;
  /** Fixed years: "2026" → its titles as they were when fixed. */
  years: Record<string, CinemaYear>;
  /** Fixes (or fixes again) a year with these titles; unfixYear lets it follow your list again. */
  fixYear: (year: number, items: CinemaTitle[]) => Promise<void>;
  unfixYear: (year: number) => Promise<void>;
  /** Years left off "Year in film" (the titles keep them). */
  hiddenYears: number[];
  setHiddenYears: (years: number[]) => Promise<void>;
};

const CinemaContext = createContext<CinemaStore | null>(null);

export function CinemaProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [items, setItems] = useState<CinemaTitle[]>([]);
  const [lists, setLists] = useState<CinemaList[]>([]);
  const [language, setLanguageState] = useState("uk-UA");
  const [tmdbEnabled, setTmdbEnabled] = useState(false);
  const [isLoaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toRate, setToRate] = useState<string[]>([]);
  const [years, setYears] = useState<Record<string, CinemaYear>>({});
  const [hiddenYears, setHiddenYearsState] = useState<number[]>([]);
  // Saves read from here so quick successive edits (e.g. two checkbox clicks) build on each other.
  const latest = useRef<Saved>({ items: [], language: "uk-UA", lists: [] });

  useEffect(() => {
    if (!token) return;
    apiFetch<CinemaDoc>("/cinema", { token })
      .then((d) => {
        latest.current = { items: d.items, language: d.language, lists: d.lists ?? [] };
        setItems(d.items);
        setLists(d.lists ?? []);
        setLanguageState(d.language);
        setTmdbEnabled(d.tmdb_enabled);
        setYears(d.years ?? {});
        setHiddenYearsState(d.hidden_years ?? []);
        setLoadError(null);
        // One after the other, so the two background saves don't race.
        void syncImdbRatings(token, d.items).then(() => syncAiring(token, d.tmdb_enabled));
      })
      .catch(() => setLoadError("Could not load your list. Is the backend running?"))
      .finally(() => setLoaded(true));

    /** Global IMDb ratings change daily: refresh them in the background and save only if something moved. */
    async function syncImdbRatings(tok: string, loaded: CinemaTitle[]) {
      const candidates = loaded.filter((t) => t.imdb_id || (t.tmdb_id && t.tmdb_media));
      if (!candidates.length) return;
      try {
        const fresh = await apiFetch<Record<string, Pick<CinemaTitle, "imdb_id" | "imdb_rating" | "imdb_votes">>>(
          "/cinema/imdb-ratings",
          { token: tok, method: "POST", body: JSON.stringify(candidates) },
        );
        const changed = (t: CinemaTitle) => {
          const f = fresh[t.id];
          return f && (f.imdb_id !== t.imdb_id || f.imdb_rating !== t.imdb_rating || f.imdb_votes !== t.imdb_votes);
        };
        if (!latest.current.items.some(changed)) return;
        const next = {
          ...latest.current,
          items: latest.current.items.map((t) => (changed(t) ? { ...t, ...fresh[t.id] } : t)),
        };
        latest.current = next;
        setItems(next.items);
        await apiFetch<CinemaDoc>("/cinema", { token: tok, method: "PUT", body: JSON.stringify(next) });
      } catch {
        // Ratings are a nice-to-have; the list works without them.
      }
    }

    /**
     * Seasons, the next episode and premieres change over time: series and anything planned are refreshed
     * once a day, other films once (for their franchise). Saved in one go at the end.
     */
    async function syncAiring(tok: string, enabled: boolean) {
      if (!enabled) return;
      const today = new Date().toISOString().slice(0, 10);
      const due = latest.current.items.filter((t) => {
        if (!t.tmdb_id || !t.tmdb_media) return false;
        // Series synced before per-season minutes existed are refreshed right away.
        if (t.tmdb_media === "tv" && !t.season_minutes?.length) return true;
        if (t.tmdb_synced === today) return false;
        if (t.tmdb_media === "tv") return t.status !== "dropped" || !t.tmdb_synced;
        return t.status === "planned" || !t.tmdb_synced;
      });
      if (!due.length) return;
      const fresh: Record<string, CinemaAiring> = {};
      try {
        for (let i = 0; i < due.length; i += 60) {
          Object.assign(
            fresh,
            await apiFetch<Record<string, CinemaAiring>>("/cinema/airing", {
              token: tok,
              method: "POST",
              body: JSON.stringify(due.slice(i, i + 60)),
            }),
          );
        }
      } catch {
        // Keep what came back before the failure; the rest is retried next time.
      }
      if (!Object.keys(fresh).length) return;
      const next = {
        ...latest.current,
        items: latest.current.items.map((t) => {
          const f = fresh[t.id];
          if (!f) return t;
          return {
            ...t,
            ...f,
            seasons: f.seasons ?? t.seasons,
            runtime: f.runtime ?? t.runtime,
            season_episodes: f.season_episodes.length ? f.season_episodes : t.season_episodes,
            season_minutes: f.season_minutes.length ? f.season_minutes : t.season_minutes,
            tmdb_synced: today,
          };
        }),
      };
      latest.current = next;
      setItems(next.items);
      try {
        await apiFetch<CinemaDoc>("/cinema", { token: tok, method: "PUT", body: JSON.stringify(next) });
      } catch {
        // Not saved: the same titles are refreshed again on the next visit.
      }
    }
  }, [token]);

  const persist = useCallback(
    async (next: Saved) => {
      const prev = latest.current;
      latest.current = next;
      setItems(next.items);
      setLists(next.lists);
      setLanguageState(next.language);
      try {
        await apiFetch<CinemaDoc>("/cinema", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) });
      } catch (e) {
        if (latest.current === next) {
          latest.current = prev;
          setItems(prev.items);
          setLists(prev.lists);
          setLanguageState(prev.language);
        }
        throw e;
      }
    },
    [token],
  );

  const update = useCallback(
    (change: (items: CinemaTitle[]) => CinemaTitle[]) => {
      const items = change(latest.current.items);
      const ask = newlyWatchedUnrated(latest.current.items, items);
      // Asked only once it's saved: a failed save puts the title back, and there'd be nothing to rate.
      return persist({ ...latest.current, items }).then(() => {
        if (ask.length) setToRate((q) => [...q, ...ask.filter((id) => !q.includes(id))]);
      });
    },
    [persist],
  );

  const dismissRate = useCallback((id: string) => setToRate((q) => q.filter((x) => x !== id)), []);

  const fixYear = useCallback(
    async (year: number, list: CinemaTitle[]) => {
      const fixed = await apiFetch<CinemaYear>(`/cinema/years/${year}`, { token: token ?? undefined, method: "PUT", body: JSON.stringify(list) });
      setYears((y) => ({ ...y, [String(year)]: fixed }));
    },
    [token],
  );

  const setHiddenYears = useCallback(
    async (next: number[]) => {
      setHiddenYearsState(await apiFetch<number[]>("/cinema/hidden-years", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) }));
    },
    [token],
  );

  const unfixYear = useCallback(
    async (year: number) => {
      await apiFetch(`/cinema/years/${year}`, { token: token ?? undefined, method: "DELETE" });
      setYears((y) => {
        const next = { ...y };
        delete next[String(year)];
        return next;
      });
    },
    [token],
  );

  const updateLists = useCallback(
    (change: (lists: CinemaList[]) => CinemaList[]) => persist({ ...latest.current, lists: change(latest.current.lists) }),
    [persist],
  );

  const setLanguage = useCallback((lang: string) => persist({ ...latest.current, language: lang }), [persist]);

  return (
    <CinemaContext.Provider value={{ items, lists, language, tmdbEnabled, isLoaded, loadError, update, updateLists, setLanguage, toRate, dismissRate, years, fixYear, unfixYear, hiddenYears, setHiddenYears }}>
      {children}
    </CinemaContext.Provider>
  );
}

export function useCinema(): CinemaStore {
  const ctx = useContext(CinemaContext);
  if (!ctx) throw new Error("useCinema must be used inside CinemaProvider");
  return ctx;
}
