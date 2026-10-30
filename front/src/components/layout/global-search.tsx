"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { childLinks } from "@/components/layout/sidebar";
import { cinemaKindMeta } from "@/features/cinema/nav";
import type { CinemaTitle } from "@/features/cinema/types";
import { Poster } from "@/features/cinema/ui";
import { libraryKindMeta } from "@/features/library/nav";
import type { LibraryItem } from "@/features/library/types";
import { TickerLogo } from "@/features/investing/watchlist/ticker-logo";
import { apiFetch } from "@/lib/api";
import { isCategoryVisible } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useCategories } from "@/state/categories-store";
import { useInvesting } from "@/state/investing-store";

type Game = { id: string; title: string; year: number | null };
type Task = { id: string; title: string; status: string };
type Data = { cinema: CinemaTitle[]; library: LibraryItem[]; games: Game[]; tasks: Task[] };

type Group = "Pages" | "Films and series" | "Books" | "Games" | "Tasks" | "Stocks";
type Result = { id: string; group: Group; title: string; sub: string; href: string; thumb?: { src: string } | { ticker: string } };

const GROUPS: Group[] = ["Pages", "Stocks", "Films and series", "Books", "Games", "Tasks"];
const PER_GROUP = 6;
const TTL = 2 * 60 * 1000;

// Lists are loaded when the palette opens and kept for a couple of minutes, so typing never waits on the network.
let cache: { at: number; token: string; data: Data } | null = null;

async function loadData(token: string): Promise<Data> {
  if (cache && cache.token === token && Date.now() - cache.at < TTL) return cache.data;
  const get = <T,>(path: string, pick: (r: never) => T[]) =>
    apiFetch<never>(path, { token })
      .then(pick)
      .catch(() => [] as T[]);
  const [cinema, library, games, tasks] = await Promise.all([
    get<CinemaTitle>("/cinema", (r: { items: CinemaTitle[] }) => r.items),
    get<LibraryItem>("/library", (r: { items: LibraryItem[] }) => r.items),
    get<Game>("/games", (r: { games: Game[] }) => r.games),
    get<Task>("/tasks", (r: { tasks: Task[] }) => r.tasks),
  ]);
  const data = { cinema, library, games, tasks };
  cache = { at: Date.now(), token, data };
  return data;
}

/** Lower case, no accents or punctuation, ґ = г: "Pokémon" and "pokemon" match. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ґ/g, "г")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** 3 for a match at the start, 2 at the start of a word, 1 anywhere; 0 for none. Best over all `fields`. */
function score(q: string, fields: (string | null | undefined)[]): number {
  let best = 0;
  for (const f of fields) {
    if (!f) continue;
    const s = norm(f);
    if (s.startsWith(q)) return 3;
    if (s.includes(` ${q}`)) best = Math.max(best, 2);
    else if (s.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

export function GlobalSearch() {
  const t = useT();
  const router = useRouter();
  const { token } = useAuth();
  const { categories, subcategoriesByCategoryId } = useCategories();
  const { holdings, pickingRows } = useInvesting();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const show = useCallback(() => {
    setQuery("");
    setActive(0);
    setOpen(true);
    if (token) void loadData(token).then(setData);
  }, [token]);

  // Ctrl+K / ⌘K anywhere, or "/" when not typing in a field.
  useEffect(() => {
    if (!token) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
      if ((e.key === "k" || e.key === "K" || e.code === "KeyK") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        show();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [token, open, show]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return [];
    const out: (Result & { score: number })[] = [];
    const add = (r: Result, fields: (string | null | undefined)[]) => {
      const s = score(q, fields);
      if (s) out.push({ ...r, score: s });
    };

    for (const cat of categories.filter((c) => isCategoryVisible(c.slug))) {
      const links = childLinks(cat, subcategoriesByCategoryId[cat.id] ?? []);
      add({ id: `cat-${cat.id}`, group: "Pages", title: t(cat.name), sub: "", href: links.find((l) => l.key === "home")?.href ?? links[0]?.href ?? "/" }, [cat.name, t(cat.name)]);
      for (const l of links.filter((x) => x.key !== "home")) {
        add({ id: `page-${cat.id}-${l.key}`, group: "Pages", title: t(l.name), sub: t(cat.name), href: l.href }, [l.name, t(l.name)]);
      }
    }

    const tickers = new Map<string, Result>();
    for (const h of holdings) {
      const k = h.ticker.trim().toUpperCase();
      if (k) tickers.set(k, { id: `h-${k}`, group: "Stocks", title: k, sub: [h.name, t("In your portfolio")].filter(Boolean).join(" · "), href: "/investing/holdings", thumb: { ticker: k } });
    }
    for (const p of pickingRows) {
      const k = p.ticker.trim().toUpperCase();
      if (k && !tickers.has(k)) tickers.set(k, { id: `w-${k}`, group: "Stocks", title: k, sub: [p.name, t("Watchlist")].filter(Boolean).join(" · "), href: "/investing/picking", thumb: { ticker: k } });
    }
    const names = new Map([...holdings, ...pickingRows].map((x) => [x.ticker.trim().toUpperCase(), x.name] as const));
    for (const [k, r] of tickers) add(r, [k, names.get(k)]);

    for (const x of data?.cinema ?? []) {
      const meta = cinemaKindMeta(x.kind);
      add(
        {
          id: `c-${x.id}`,
          group: "Films and series",
          title: x.title,
          sub: [x.year, t(meta.label), x.score != null ? `★ ${x.score}` : ""].filter(Boolean).join(" · "),
          href: `/cinematography/${meta.slug}?open=${encodeURIComponent(x.id)}`,
          thumb: { src: x.poster },
        },
        [x.title, x.original_title],
      );
    }
    for (const x of data?.library ?? []) {
      const meta = libraryKindMeta(x.kind);
      add(
        {
          id: `l-${x.id}`,
          group: "Books",
          title: x.title,
          sub: [x.authors[0], x.finish_date.slice(0, 4), x.score != null ? `★ ${x.score}` : ""].filter(Boolean).join(" · ") || t(meta.label),
          href: `/library/${meta.slug}?open=${encodeURIComponent(x.id)}`,
          thumb: { src: x.cover },
        },
        [x.title, x.original_title, ...x.authors],
      );
    }
    for (const x of data?.games ?? []) {
      add({ id: `g-${x.id}`, group: "Games", title: x.title, sub: x.year ? String(x.year) : "", href: `/life/games?q=${encodeURIComponent(x.title)}` }, [x.title]);
    }
    for (const x of data?.tasks ?? []) {
      add({ id: `t-${x.id}`, group: "Tasks", title: x.title, sub: t(TASK_STATUS[x.status] ?? "To do"), href: "/life/tasks" }, [x.title]);
    }

    return GROUPS.flatMap((g) =>
      out
        .filter((r) => r.group === g)
        .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
        .slice(0, PER_GROUP),
    );
  }, [query, categories, subcategoriesByCategoryId, holdings, pickingRows, data, t]);

  const current = Math.min(active, Math.max(results.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function go(r: Result | undefined) {
    if (!r) return;
    setOpen(false);
    router.push(r.href);
  }

  if (!token) return null;

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label={t("Search")}
        aria-keyshortcuts="Control+K"
        className="flex h-9 w-9 shrink-0 items-center justify-center gap-2 rounded-full border border-black/10 bg-white/80 text-left sm:w-full sm:max-w-md sm:justify-start sm:px-3.5 text-xs text-[#8f8676] transition hover:border-black/20 hover:bg-white"
      >
        <SearchIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden flex-1 truncate sm:inline">{t("Search films, books, games, stocks…")}</span>
        <kbd className="ml-auto hidden rounded-md border border-black/10 bg-[#faf8f2] px-1.5 py-0.5 font-sans text-[10px] font-medium text-[#8f8676] sm:inline">Ctrl K</kbd>
      </button>

      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label={t("Search")}>
              <button type="button" aria-label={t("Close")} onClick={() => setOpen(false)} className="absolute inset-0 bg-[#1f1c17]/30 backdrop-blur-[2px]" />
              <div className="relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_24px_60px_rgba(18,16,13,0.2)]">
                <div className="flex items-center gap-2.5 border-b border-black/5 px-4">
                  <SearchIcon className="h-4 w-4 shrink-0 text-[#8f8676]" />
                  <input
                    ref={inputRef}
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setActive(Math.min(current + 1, results.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setActive(Math.max(current - 1, 0));
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        go(results[current]);
                      } else if (e.key === "Escape") {
                        setOpen(false);
                      }
                    }}
                    placeholder={t("Search films, books, games, stocks…")}
                    role="combobox"
                    aria-expanded={results.length > 0}
                    aria-controls="global-search-results"
                    aria-activedescendant={results[current] ? `gs-${results[current].id}` : undefined}
                    className="h-12 min-w-0 flex-1 bg-transparent text-sm text-[#1f1c17] outline-none placeholder:text-[#a39a89]"
                  />
                  <kbd className="rounded-md border border-black/10 bg-[#faf8f2] px-1.5 py-0.5 font-sans text-[10px] text-[#8f8676]">Esc</kbd>
                </div>

                {!query.trim() ? (
                  <p className="px-4 py-6 text-center text-xs text-[#8f8676]">{t("Type a title, author, ticker or page name. ↑↓ to choose, Enter to open.")}</p>
                ) : !results.length ? (
                  <p className="px-4 py-6 text-center text-xs text-[#8f8676]">{data ? t("Nothing found.") : t("Loading…")}</p>
                ) : (
                  <ul ref={listRef} id="global-search-results" role="listbox" className="overflow-y-auto py-1.5">
                    {results.map((r, i) => (
                      <li key={r.id} role="presentation">
                        {i === 0 || results[i - 1].group !== r.group ? (
                          <p className="px-4 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-[#a39a89]">{t(r.group)}</p>
                        ) : null}
                        <button
                          type="button"
                          id={`gs-${r.id}`}
                          role="option"
                          aria-selected={i === current}
                          data-index={i}
                          onMouseMove={() => i !== current && setActive(i)}
                          onClick={() => go(r)}
                          className={`flex w-full items-center gap-3 px-4 py-1.5 text-left ${i === current ? "bg-[#f3efe5]" : ""}`}
                        >
                          {r.thumb && "ticker" in r.thumb ? (
                            <TickerLogo ticker={r.thumb.ticker} size={28} />
                          ) : r.thumb ? (
                            <Poster src={r.thumb.src} title={r.title} className="h-10 w-7 shrink-0" />
                          ) : (
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f3efe5] text-xs text-[#8f8676]" aria-hidden>
                              {r.group === "Pages" ? "↗" : r.group === "Games" ? "◆" : "✓"}
                            </span>
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-[#1f1c17]">{r.title}</span>
                            {r.sub ? <span className="block truncate text-[11px] text-[#8f8676]">{r.sub}</span> : null}
                          </span>
                          {i === current ? <span className="shrink-0 text-[11px] text-[#a39a89]">↵</span> : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

const TASK_STATUS: Record<string, string> = { todo: "To do", hold: "Hold", in_progress: "In progress", completed: "Completed" };

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
