"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { categoryLook, ChevronIcon, PlusIcon } from "@/components/layout/icons";
import { childLinks } from "@/components/layout/sidebar";
import { formatUsd, parseUsd } from "@/features/investing/format";
import { apiFetch } from "@/lib/api";
import { categoryHref } from "@/lib/category-href";
import { isCategoryVisible } from "@/lib/features";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useCategories, type Category } from "@/state/categories-store";
import { useInvesting } from "@/state/investing-store";

const card = "rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

type Stat = { value: string; label: string; tone?: "up" | "down" };

type Summaries = {
  tasks?: { status: string }[];
  games?: { year: number | null }[];
  cinema?: { status: string; view_year: number | null }[];
  library?: { status: string; finish_date: string }[];
};

/** Loads the small per-section lists the cards summarise; each one fails on its own. */
function useSummaries(token: string | null): Summaries {
  const [data, setData] = useState<Summaries>({});
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = <K extends keyof Summaries>(key: K, path: string, pick: (r: never) => Summaries[K]) =>
      apiFetch<never>(path, { token })
        .then((r) => {
          if (alive) setData((d) => ({ ...d, [key]: pick(r) }));
        })
        .catch(() => {});
    load("tasks", "/tasks", (r: { tasks: { status: string }[] }) => r.tasks);
    load("games", "/games", (r: { games: { year: number | null }[] }) => r.games);
    load("cinema", "/cinema", (r: { items: { status: string; view_year: number | null }[] }) => r.items);
    load("library", "/library", (r: { items: { status: string; finish_date: string }[] }) => r.items);
    return () => {
      alive = false;
    };
  }, [token]);
  return data;
}

function greetingKey(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function StatRow({ stats }: { stats: Stat[] | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-3 gap-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <div className="h-6 w-12 animate-pulse rounded bg-black/[0.05]" />
            <div className="mt-1.5 h-3 w-16 animate-pulse rounded bg-black/[0.04]" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <dl className="grid grid-cols-3 gap-3">
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="sr-only">{s.label}</dt>
          <dd className={`truncate text-xl font-semibold tabular-nums ${s.tone === "up" ? "text-emerald-700" : s.tone === "down" ? "text-rose-700" : "text-[#1f1c17]"}`}>
            {s.value}
          </dd>
          <dd className="truncate text-[11px] text-[#8f8676]" aria-hidden>
            {s.label}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** `stats`: undefined = this section has no summary, null = still loading. */
function SectionCard({ cat, stats, links }: { cat: Category; stats: Stat[] | null | undefined; links: { key: string; name: string; href: string }[] }) {
  const t = useT();
  const { Icon, tile } = categoryLook(cat.slug);
  const href = categoryHref(cat.slug);
  return (
    <article className={`${card} group flex flex-col p-5 transition hover:border-black/10`}>
      <Link href={href} className="flex items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tile}`}>
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="flex-1 text-base font-semibold text-[#1f1c17]">{t(cat.name)}</h2>
        <ChevronIcon className="h-4 w-4 text-[#b5ad9f] transition group-hover:translate-x-0.5 group-hover:text-[#1f1c17]" />
      </Link>
      <div className="mt-4 flex-1">
        {stats === undefined ? null : <StatRow stats={stats} />}
      </div>
      {links.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-black/5 pt-3">
          {links.map((l) => (
            <Link
              key={l.key}
              href={l.href}
              className="rounded-full bg-[#f4efe4] px-2.5 py-1 text-[11px] font-medium text-[#5f584d] transition hover:bg-[#1f1c17] hover:text-[#f8f4eb]"
            >
              {t(l.name)}
            </Link>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AddCategory() {
  const { create } = useCategories();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t("Name is too short"));
      return;
    }
    try {
      await create(trimmed);
      setName("");
      setOpen(false);
    } catch {
      setError(t("Failed to create category"));
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[148px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-black/15 text-sm font-medium text-[#8f8676] transition hover:border-black/30 hover:bg-white/50 hover:text-[#1f1c17]"
      >
        <PlusIcon className="h-5 w-5" />
        {t("Add category")}
      </button>
    );
  }
  return (
    <form onSubmit={onAdd} className={`${card} flex flex-col justify-center gap-2 p-5`}>
      <label>
        <span className="text-xs font-medium text-[#6f675b]">{t("Category name")}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30"
          placeholder={t("e.g. Health, Learning, Projects…")}
        />
      </label>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className="rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-xs font-medium text-[#f8f4eb] hover:bg-[#2c2923]">
          {t("Create")}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
            setError(null);
          }}
          className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
        >
          {t("Cancel")}
        </button>
      </div>
    </form>
  );
}

export default function Home() {
  const { token } = useAuth();
  const { categories, isLoading, subcategoriesByCategoryId } = useCategories();
  const { holdings, isHoldingsLoading } = useInvesting();
  const t = useT();
  const locale = useLocale();
  const data = useSummaries(token);
  const [now] = useState(() => new Date());
  const year = now.getFullYear();
  const n = (v: number) => v.toLocaleString(locale);

  function statsFor(slug: string): Stat[] | null | undefined {
    if (slug === "life") {
      if (!data.tasks || !data.games) return null;
      const c = (s: string) => data.tasks!.filter((x) => x.status === s).length;
      return [
        { value: n(c("todo")), label: t("To do") },
        { value: n(c("in_progress")), label: t("In progress") },
        { value: n(data.games.filter((x) => x.year === year).length), label: t("Games in {year}", { year }) },
      ];
    }
    if (slug === "cinematography") {
      if (!data.cinema) return null;
      const items = data.cinema;
      return [
        { value: n(items.filter((x) => x.status !== "planned" && x.view_year === year).length), label: t("Watched in {year}", { year }) },
        { value: n(items.filter((x) => x.status === "watching").length), label: t("Watching now") },
        { value: n(items.filter((x) => x.status === "planned").length), label: t("Watchlist") },
      ];
    }
    if (slug === "library") {
      if (!data.library) return null;
      const items = data.library;
      return [
        { value: n(items.filter((x) => x.status === "read" && x.finish_date.startsWith(String(year))).length), label: t("Read in {year}", { year }) },
        { value: n(items.filter((x) => x.status === "reading").length), label: t("Reading now") },
        { value: n(items.filter((x) => x.status === "read").length), label: t("Read in total") },
      ];
    }
    if (slug === "investing") {
      if (isHoldingsLoading && !holdings.length) return null;
      const value = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
      // Today's move from each holding's day change: value − value / (1 + pct).
      const day = holdings.reduce((a, h) => {
        const pct = parseFloat(String(h.dayChangePercent ?? "").replace("%", ""));
        const v = parseUsd(h.marketValue);
        return Number.isFinite(pct) ? a + (v - v / (1 + pct / 100)) : a;
      }, 0);
      const dayPct = value - day > 0 ? (day / (value - day)) * 100 : 0;
      return [
        { value: formatUsd(value), label: t("Portfolio value") },
        { value: `${day >= 0 ? "+" : "−"}${formatUsd(Math.abs(day))}`, label: `${t("Today")} · ${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%`, tone: day > 0 ? "up" : day < 0 ? "down" : undefined },
        { value: n(holdings.length), label: t("Positions") },
      ];
    }
    return undefined;
  }

  const visible = categories.filter((cat) => isCategoryVisible(cat.slug));

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">
            {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t(greetingKey(now.getHours()))}</h1>
          <p className="mt-1.5 text-sm text-[#655d51]">{t("Here’s where everything stands.")}</p>
        </div>

        <section className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {isLoading && !visible.length
            ? [0, 1, 2, 3].map((i) => <div key={i} className={`${card} h-[180px] animate-pulse`} />)
            : visible.map((cat) => (
                <SectionCard
                  key={cat.id}
                  cat={cat}
                  stats={statsFor(cat.slug)}
                  links={childLinks(cat, subcategoriesByCategoryId[cat.id] ?? [])
                    .filter((l) => l.key !== "home")
                    .slice(0, 5)}
                />
              ))}
          {!isLoading ? <AddCategory /> : null}
        </section>
      </div>
    </RequireAuth>
  );
}
