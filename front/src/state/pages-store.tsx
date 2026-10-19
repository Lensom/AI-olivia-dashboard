"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { PageKind, PageSummary } from "@/features/pages/types";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./auth-store";

type PagesStore = {
  pages: PageSummary[];
  isLoaded: boolean;
  /** Children of a page (null = top level), in display order. */
  childrenOf: (parentId: string | null) => PageSummary[];
  byId: Map<string, PageSummary>;
  create: (input: { parent_id: string | null; kind: PageKind; title?: string; icon?: string; content?: unknown }) => Promise<PageSummary>;
  /** Updates the tree entry right away and saves; title / icon changes show in the tree immediately. */
  patch: (id: string, patch: Partial<Pick<PageSummary, "title" | "icon">> & { content?: unknown }) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Places `id` under `parentId` at `index` among its new siblings. */
  move: (id: string, parentId: string | null, index: number) => Promise<void>;
};

const PagesContext = createContext<PagesStore | null>(null);

export function PagesProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [isLoaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!token) return;
    apiFetch<PageSummary[]>("/pages", { token })
      .then(setPages)
      .catch(() => setPages([]))
      .finally(() => setLoaded(true));
  }, [token]);

  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  const childrenOf = useCallback(
    (parentId: string | null) =>
      pages.filter((p) => (p.parent_id ?? null) === parentId).sort((a, b) => a.sort_order - b.sort_order),
    [pages],
  );

  const create: PagesStore["create"] = useCallback(
    async (input) => {
      const page = await apiFetch<PageSummary>("/pages", { token: token ?? undefined, method: "POST", body: JSON.stringify(input) });
      setPages((prev) => [...prev, page]);
      return page;
    },
    [token],
  );

  // Saves for one page run strictly one after another, so an older edit can never land last.
  const chains = useRef(new Map<string, Promise<unknown>>());

  const patch: PagesStore["patch"] = useCallback(
    (id, changes) => {
      const { content, ...meta } = changes;
      if (Object.keys(meta).length) setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...meta } : p)));
      const run = (chains.current.get(id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(() =>
          apiFetch<PageSummary>(`/pages/${id}`, {
            token: token ?? undefined,
            method: "PATCH",
            body: JSON.stringify(content === undefined ? meta : { ...meta, content }),
          }),
        )
        .then((saved) => {
          setPages((prev) => prev.map((p) => (p.id === id ? { ...p, updated_at: saved.updated_at } : p)));
        });
      chains.current.set(id, run);
      return run;
    },
    [token],
  );

  const remove: PagesStore["remove"] = useCallback(
    async (id) => {
      await apiFetch<unknown>(`/pages/${id}`, { token: token ?? undefined, method: "DELETE" }).catch((e) => {
        // 204 has no JSON body; only real errors should surface.
        if ((e as { status?: number })?.status) throw e;
      });
      setPages((prev) => {
        const gone = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const p of prev) {
            if (p.parent_id && gone.has(p.parent_id) && !gone.has(p.id)) {
              gone.add(p.id);
              grew = true;
            }
          }
        }
        return prev.filter((p) => !gone.has(p.id));
      });
    },
    [token],
  );

  const move: PagesStore["move"] = useCallback(
    async (id, parentId, index) => {
      const siblings = pages.filter((p) => (p.parent_id ?? null) === parentId && p.id !== id).sort((a, b) => a.sort_order - b.sort_order);
      const moving = pages.find((p) => p.id === id);
      if (!moving) return;
      siblings.splice(Math.max(0, Math.min(index, siblings.length)), 0, moving);
      // Renumber the new sibling list; only pages whose place changed are saved.
      const updates = siblings
        .map((p, i) => ({ p, order: (i + 1) * 10 }))
        .filter(({ p, order }) => p.sort_order !== order || (p.id === id && (p.parent_id ?? null) !== parentId));
      setPages((prev) =>
        prev.map((p) => {
          const u = updates.find((x) => x.p.id === p.id);
          return u ? { ...p, sort_order: u.order, parent_id: p.id === id ? parentId : p.parent_id } : p;
        }),
      );
      for (const { p, order } of updates) {
        await apiFetch<PageSummary>(`/pages/${p.id}`, {
          token: token ?? undefined,
          method: "PATCH",
          body: JSON.stringify(p.id === id ? { parent_id: parentId ?? "", sort_order: order } : { sort_order: order }),
        });
      }
    },
    [pages, token],
  );

  return (
    <PagesContext.Provider value={{ pages, isLoaded, childrenOf, byId, create, patch, remove, move }}>{children}</PagesContext.Provider>
  );
}

export function usePages(): PagesStore {
  const ctx = useContext(PagesContext);
  if (!ctx) throw new Error("usePages must be used inside PagesProvider");
  return ctx;
}
