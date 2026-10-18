"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { LibraryItem } from "@/features/library/types";
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
      })
      .catch(() => setLoadError("Could not load your library. Is the backend running?"))
      .finally(() => setLoaded(true));
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
    <LibraryContext.Provider value={{ items, lists, googleEnabled, isLoaded, loadError, update, updateLists }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryStore {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}
