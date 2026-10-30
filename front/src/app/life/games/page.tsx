"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { investingPrimarySaveActive } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

/** Mirrors back/app/games/router.py. */
type Game = { id: string; title: string; year: number | null; added_at: string };
type Sort = "title" | "year";

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}`);
const parseYear = (v: string) => {
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 1970 && n <= 2100 ? n : null;
};

function GameRow({ game, onSave, onDelete }: { game: Game; onSave: (g: Game) => void; onDelete: () => void }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(game.title);
  const [year, setYear] = useState(game.year?.toString() ?? "");

  const finish = () => {
    setEditing(false);
    const name = title.trim();
    if (name && (name !== game.title || parseYear(year) !== game.year)) onSave({ ...game, title: name, year: parseYear(year) });
    else {
      setTitle(game.title);
      setYear(game.year?.toString() ?? "");
    }
  };

  if (editing) {
    return (
      <li className="flex items-center gap-2 px-4 py-1.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && finish()}
          autoFocus
          maxLength={300}
          aria-label={t("Game")}
          className="min-w-0 flex-1 rounded-md border border-black/10 px-2 py-1 text-sm outline-none focus:border-black/25"
        />
        <input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(e) => e.key === "Enter" && finish()}
          inputMode="numeric"
          placeholder={t("Year")}
          aria-label={t("Year")}
          className="w-20 rounded-md border border-black/10 px-2 py-1 text-sm tabular-nums outline-none focus:border-black/25"
        />
        <button type="button" onClick={finish} className="rounded-md px-2 py-1 text-xs font-medium text-[#1f1c17] hover:bg-[#f3efe5]">
          {t("Save")}
        </button>
      </li>
    );
  }
  return (
    <li className="group flex items-baseline gap-2 px-4 py-2 hover:bg-[#fcfbf7]">
      <span className="min-w-0 flex-1 truncate text-sm text-[#1f1c17]" onDoubleClick={() => setEditing(true)}>
        {game.title}
      </span>
      <span className={`shrink-0 text-sm tabular-nums ${game.year ? "text-rose-600" : "text-[#c5bdb0]"}`}>{game.year ?? "—"}</span>
      <span className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={() => setEditing(true)} aria-label={t("Edit “{title}”", { title: game.title })} className="rounded px-1 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17]">
          ✎
        </button>
        <button type="button" onClick={onDelete} aria-label={t("Delete “{title}”", { title: game.title })} className="rounded px-1 text-xs text-[#8f8676] hover:bg-rose-50 hover:text-rose-700">
          ✕
        </button>
      </span>
    </li>
  );
}

function GamesPage({ initialQuery }: { initialQuery: string }) {
  const { token } = useAuth();
  const t = useT();
  const locale = useLocale();
  const [games, setGames] = useState<Game[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<Sort>("title");
  const latest = useRef<Game[]>([]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ games: Game[] }>("/games", { token })
      .then((d) => {
        latest.current = d.games;
        setGames(d.games);
      })
      .catch(() => setError("Could not load your games. Is the backend running?"))
      .finally(() => setLoaded(true));
  }, [token]);

  /** Applies a change right away and saves it; puts the list back if saving fails. */
  async function commit(change: (g: Game[]) => Game[]) {
    const prev = latest.current;
    const next = change(prev);
    latest.current = next;
    setGames(next);
    try {
      await apiFetch("/games", { token: token ?? undefined, method: "PUT", body: JSON.stringify({ games: next }) });
      setError(null);
    } catch {
      if (latest.current === next) {
        latest.current = prev;
        setGames(prev);
      }
      setError("Could not save — the change was undone.");
    }
  }

  function addGame() {
    const name = title.trim();
    if (!name) return;
    setTitle("");
    void commit((all) => [{ id: newId(), title: name, year: parseYear(year), added_at: new Date().toISOString().slice(0, 10) }, ...all]);
  }

  // Groups to render: one alphabetical list, or one group per year (newest first, unknown year last).
  const groups = useMemo(() => {
    const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title, locale, { numeric: true, sensitivity: "base" });
    const q = query.trim().toLowerCase();
    const list = games.filter((g) => !q || g.title.toLowerCase().includes(q)).sort(byTitle);
    if (sort === "title") return [{ key: "all", label: "", list }];
    const years = [...new Set(list.map((g) => g.year))].sort((a, b) => (b ?? -1) - (a ?? -1));
    return years.map((y) => ({ key: String(y), label: y == null ? t("Year unknown") : String(y), list: list.filter((g) => g.year === y) }));
  }, [games, query, sort, locale, t]);

  const thisYear = new Date().getFullYear();
  const shownCount = groups.reduce((n, g) => n + g.list.length, 0);
  const sortBtn = (s: Sort, label: string) => (
    <button
      type="button"
      onClick={() => setSort(s)}
      aria-pressed={sort === s}
      className={`rounded-full px-3 py-1 text-xs font-medium ${sort === s ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
    >
      {t(label)}
    </button>
  );

  return (
    <RequireAuth>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Games completed")}</h1>
          {loaded && games.length ? (
            <p className="mt-1 text-sm text-[#6f675b]">
              {t("{n} games", { n: games.length })} · {t("{n} in {year}", { n: games.filter((g) => g.year === thisYear).length, year: thisYear })}
            </p>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            addGame();
          }}
          className="flex gap-2"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("Game you finished")}
            maxLength={300}
            aria-label={t("Game")}
            className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none focus:border-black/25"
          />
          <input
            value={year}
            onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
            inputMode="numeric"
            placeholder={t("Year")}
            aria-label={t("Year finished")}
            className="w-24 rounded-full border border-black/10 bg-white px-4 py-2 text-sm tabular-nums outline-none focus:border-black/25"
          />
          <button type="submit" disabled={!title.trim()} className={`${investingPrimarySaveActive} disabled:opacity-40`}>
            {t("Add")}
          </button>
        </form>

        {error ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(error)}</p> : null}

        {!loaded ? (
          <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>
        ) : !games.length ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center text-sm text-[#6f675b]">{t("Add the first game you've finished above.")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search games…")}
                className="w-full rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs outline-none focus:border-black/25 sm:w-56"
              />
              <span className="ml-auto inline-flex rounded-full border border-black/10 bg-white p-0.5">
                {sortBtn("title", "A–Z")}
                {sortBtn("year", "By year")}
              </span>
            </div>
            {!shownCount ? (
              <p className="text-sm text-[#8f8676]">{t("Nothing matches these filters.")}</p>
            ) : (
              <div className="space-y-3">
                {groups.map((g) => (
                  <section key={g.key} className="overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
                    {g.label ? (
                      <h2 className="flex items-baseline justify-between border-b border-black/5 bg-[#faf8f2] px-4 py-2 text-xs">
                        <span className="font-semibold text-[#1f1c17]">{g.label}</span>
                        <span className="text-[#8f8676]">{t("{n} games", { n: g.list.length })}</span>
                      </h2>
                    ) : null}
                    <ul className="divide-y divide-black/5">
                      {g.list.map((game) => (
                        <GameRow
                          key={game.id}
                          game={game}
                          onSave={(next) => void commit((all) => all.map((x) => (x.id === next.id ? next : x)))}
                          onDelete={() => void commit((all) => all.filter((x) => x.id !== game.id))}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </RequireAuth>
  );
}

/** `?q=` (from global search) pre-fills the search box. */
function GamesRoute() {
  const q = useSearchParams().get("q") ?? "";
  return <GamesPage key={q} initialQuery={q} />;
}

export default function GamesRoutePage() {
  return (
    <Suspense>
      <GamesRoute />
    </Suspense>
  );
}
