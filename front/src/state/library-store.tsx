"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { LibraryItem, LibraryWikidata } from "@/features/library/types";
import type { RankedList } from "@/features/shared/tops-board";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./auth-store";

type LibraryDoc = { items: LibraryItem[]; lists: RankedList[]; updated_at: string | null; google_enabled: boolean };
type Saved = { items: LibraryItem[]; lists: RankedList[] };

type LibraryStore = {
  items: LibraryItem[];
  lists: RankedList[];
  googleEnabled: boolean;
  isLoaded: boolean;
  loadError: string | null;
  /** Wikidata (series) lookup running in the background. */
  isSyncingSeries: boolean;
  /** Applies `change` to the latest list and saves it right away; reverts and throws if the save fails. */
  update: (change: (items: LibraryItem[]) => LibraryItem[]) => Promise<void>;
  updateLists: (change: (lists: RankedList[]) => RankedList[]) => Promise<void>;
};

const LibraryContext = createContext<LibraryStore | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [lists, setLists] = useState<RankedList[]>([]);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [isLoaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSyncingSeries, setSyncingSeries] = useState(false);
  // Saves read from here so quick successive edits build on each other.
  const latest = useRef<Saved>({ items: [], lists: [] });

  useEffect(() => {
    if (!token) return;
    apiFetch<LibraryDoc>("/library", { token })
      .then((d) => {
        latest.current = { items: d.items, lists: d.lists ?? [] };
        setItems(d.items);
        setLists(d.lists ?? []);
        setGoogleEnabled(d.google_enabled);
        setLoadError(null);
        void syncWikidata(token);
      })
      .catch(() => setLoadError("Could not load your library. Is the backend running?"))
      .finally(() => setLoaded(true));

    /** Series come from Wikidata: new books are looked up once, the rest again monthly. Saved in one go. */
    async function syncWikidata(tok: string) {
      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const due = latest.current.items.filter((t) => t.kind !== "magazine" && (t.wikidata_synced ?? "") < monthAgo);
      if (!due.length) return;
      setSyncingSeries(true);
      const fresh = new Map<string, LibraryWikidata>();
      try {
        for (let i = 0; i < due.length; i += 20) {
          const chunk = due.slice(i, i + 20).map((t) => ({ id: t.id, title: t.title, original_title: t.original_title, authors: t.authors, source: t.source, source_id: t.source_id }));
          for (const r of await apiFetch<LibraryWikidata[]>("/library/wikidata", { token: tok, method: "POST", body: JSON.stringify(chunk) })) fresh.set(r.id, r);
        }
      } catch {
        // Keep what came back before the failure; the rest is retried next time.
      }
      if (fresh.size) {
        const next = {
          ...latest.current,
          items: latest.current.items.map((t) => (fresh.has(t.id) ? { ...t, ...fresh.get(t.id)!, wikidata_synced: today } : t)),
        };
        latest.current = next;
        setItems(next.items);
        try {
          await apiFetch<LibraryDoc>("/library", { token: tok, method: "PUT", body: JSON.stringify(next) });
        } catch {
          // Not saved: the same books are looked up again on the next visit.
        }
      }
      setSyncingSeries(false);
    }
  }, [token]);

  const persist = useCallback(
    async (next: Saved) => {
      const prev = latest.current;
      latest.current = next;
      setItems(next.items);
      setLists(next.lists);
      try {
        await apiFetch<LibraryDoc>("/library", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) });
      } catch (e) {
        if (latest.current === next) {
          latest.current = prev;
          setItems(prev.items);
          setLists(prev.lists);
        }
        throw e;
      }
    },
    [token],
  );

  const update = useCallback(
    (change: (items: LibraryItem[]) => LibraryItem[]) => persist({ ...latest.current, items: change(latest.current.items) }),
    [persist],
  );
  const updateLists = useCallback(
    (change: (lists: RankedList[]) => RankedList[]) => persist({ ...latest.current, lists: change(latest.current.lists) }),
    [persist],
  );

  return (
    <LibraryContext.Provider value={{ items, lists, googleEnabled, isLoaded, loadError, isSyncingSeries, update, updateLists }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryStore {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
