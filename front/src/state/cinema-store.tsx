"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CinemaList, CinemaTitle } from "@/features/cinema/types";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./auth-store";

type CinemaDoc = { items: CinemaTitle[]; language: string; lists: CinemaList[]; updated_at: string | null; tmdb_enabled: boolean };
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
        setLoadError(null);
        void syncImdbRatings(token, d.items);
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
    (change: (items: CinemaTitle[]) => CinemaTitle[]) =>
      persist({ ...latest.current, items: change(latest.current.items) }),
    [persist],
  );

  const updateLists = useCallback(
    (change: (lists: CinemaList[]) => CinemaList[]) => persist({ ...latest.current, lists: change(latest.current.lists) }),
    [persist],
  );

  const setLanguage = useCallback((lang: string) => persist({ ...latest.current, language: lang }), [persist]);

  return (
    <CinemaContext.Provider value={{ items, lists, language, tmdbEnabled, isLoaded, loadError, update, updateLists, setLanguage }}>
      {children}
    </CinemaContext.Provider>
  );
}

export function useCinema(): CinemaStore {
  const ctx = useContext(CinemaContext);
  if (!ctx) throw new Error("useCinema must be used inside CinemaProvider");
  return ctx;
}
