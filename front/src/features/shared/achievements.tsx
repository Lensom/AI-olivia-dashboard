"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLocale, useT } from "@/lib/i18n";

/** Medals for counted milestones, shared by Cinematography and Library. */
export type Medal = "none" | "bronze" | "silver" | "gold";

export const MEDALS: Record<Medal, { label: string; ring: string; badge: string }> = {
  gold: { label: "Gold", ring: "#d4a017", badge: "bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950" },
  silver: { label: "Silver", ring: "#8f9bab", badge: "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900" },
  bronze: { label: "Bronze", ring: "#b8733a", badge: "bg-gradient-to-br from-orange-200 to-orange-400 text-orange-950" },
  none: { label: "Not yet", ring: "#cfc8bb", badge: "bg-[#ece6da] text-[#8f8676]" },
};

export type AchievementDef<C> = {
  id: string;
  group: string;
  /** What is counted, as a plain label: "Titles watched". */
  label: string;
  hint: string;
  /** Bronze, silver, gold thresholds. */
  tiers: [number, number, number];
  value: (c: C) => { n: number; detail?: string };
};

export type Achievement = Omit<AchievementDef<unknown>, "value"> & {
  n: number;
  detail?: string;
  medal: Medal;
  /** Next threshold to reach, or null when gold. */
  next: number | null;
  /** 0–1 progress from the current medal's threshold to the next one. */
  progress: number;
};

export function grade<C>(def: AchievementDef<C>, ctx: C): Achievement {
  const { n, detail } = def.value(ctx);
  const [b, s, g] = def.tiers;
  const medal: Medal = n >= g ? "gold" : n >= s ? "silver" : n >= b ? "bronze" : "none";
  const floor = medal === "gold" ? g : medal === "silver" ? s : medal === "bronze" ? b : 0;
  const next = medal === "gold" ? null : medal === "silver" ? g : medal === "bronze" ? s : b;
  return { id: def.id, group: def.group, label: def.label, hint: def.hint, tiers: def.tiers, n, detail, medal, next, progress: next == null ? 1 : Math.min(1, (n - floor) / (next - floor)) };
}

/** The name that appears most across `pick(t)`, and how often. */
export function mostCommon<T>(list: T[], pick: (t: T) => string[]): { n: number; detail?: string } {
  const m = new Map<string, number>();
  for (const t of list) for (const k of new Set(pick(t))) m.set(k, (m.get(k) ?? 0) + 1);
  let best: [string, number] | null = null;
  for (const e of m) if (!best || e[1] > best[1]) best = e;
  return best ? { n: best[1], detail: best[0] } : { n: 0 };
}

/** Closest to the next medal first. */
export const byNextMedal = (a: Achievement, b: Achievement) => b.progress - a.progress;

const nextMedal = (m: Medal): Medal => (m === "none" ? "bronze" : m === "bronze" ? "silver" : "gold");

/** A ring of progress to the next medal, with the current count inside. */
export function MedalRing({ a, size = 72 }: { a: Achievement; size?: number }) {
  const t = useT();
  const locale = useLocale();
  const medal = MEDALS[a.medal];
  const stroke = 5;
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const n = a.n >= 10_000 ? `${Math.round(a.n / 1000)}k` : a.n.toLocaleString(locale);
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} title={t(medal.label)}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#efe9dc" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={a.medal === "gold" ? medal.ring : MEDALS[nextMedal(a.medal)].ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - a.progress)}
        />
      </svg>
      <span
        className={`flex items-center justify-center rounded-full font-semibold tabular-nums ${medal.badge}`}
        style={{ width: size - stroke * 2 - 8, height: size - stroke * 2 - 8, fontSize: size / 4.5 }}
      >
        {n}
      </span>
    </span>
  );
}

// One string per medal: Ukrainian needs the medal's name in another case ("до срібла").
const NEXT_TEXT: Record<Medal, string> = {
  none: "",
  bronze: "{n} more for bronze",
  silver: "{n} more for silver",
  gold: "{n} more for gold",
};

/** "23 more for silver", or the gold note. */
export function useNextText() {
  const t = useT();
  const locale = useLocale();
  return (a: Achievement) =>
    a.next == null
      ? t("Gold reached")
      : t(NEXT_TEXT[nextMedal(a.medal)], { n: (a.next - a.n).toLocaleString(locale) });
}

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const MEDAL_ORDER: Medal[] = ["gold", "silver", "bronze"];

/** Overview card: medal counts and the three achievements closest to their next medal. */
export function AchievementsCard({ achievements, href }: { achievements: Achievement[]; href: string }) {
  const t = useT();
  const nextText = useNextText();
  const medals = (m: Medal) => achievements.filter((a) => a.medal === m).length;
  const closest = achievements.filter((a) => a.next != null && a.n > 0).sort(byNextMedal).slice(0, 3);

  return (
    <section className={card} aria-labelledby="achievements-title">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="achievements-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("Achievements")}
          </h2>
          <p className="mt-1 flex flex-wrap gap-1.5">
            {MEDAL_ORDER.map((m) => (
              <span key={m} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${MEDALS[m].badge}`}>
                {t(MEDALS[m].label)} · {medals(m)}
              </span>
            ))}
            <span className="text-[11px] text-[#8f8676]">{t("of {n} achievements", { n: achievements.length })}</span>
          </p>
        </div>
        <Link href={href} className="text-xs text-[#6f675b] hover:text-[#1f1c17]">
          {t("All achievements →")}
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {closest.map((a) => (
          <li key={a.id} className="flex items-center gap-3">
            <MedalRing a={a} size={56} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[#1f1c17]">{t(a.label)}</span>
              <span className="block text-[11px] text-[#6f675b]">{nextText(a)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Achievements page: medal summary, then every achievement by group. */
export function AchievementsBoard({ achievements, groups }: { achievements: Achievement[]; groups: readonly string[] }) {
  const t = useT();
  const locale = useLocale();
  const nextText = useNextText();

  const summary = useMemo(() => {
    const earned = achievements.reduce((s, a) => s + (a.medal === "gold" ? 3 : a.medal === "silver" ? 2 : a.medal === "bronze" ? 1 : 0), 0);
    return {
      earned,
      total: achievements.length * 3,
      medals: Object.fromEntries(MEDAL_ORDER.map((m) => [m, achievements.filter((a) => a.medal === m).length])) as Record<Medal, number>,
      closest: achievements.filter((a) => a.next != null).sort(byNextMedal).slice(0, 3),
    };
  }, [achievements]);

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={`${card} border-amber-200 bg-gradient-to-br from-amber-50 to-white`}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-amber-800">{t("Medals earned")}</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums text-[#1f1c17]">
            {summary.earned} <span className="text-base font-normal text-[#8f8676]">/ {summary.total}</span>
          </p>
          <span className="mt-2 block h-2 rounded-full bg-[#f3efe5]">
            <span className="block h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500" style={{ width: `${(summary.earned / summary.total) * 100}%` }} />
          </span>
          <p className="mt-1.5 text-xs text-[#6f675b]">{t("Bronze, silver and gold for each of {n} achievements", { n: achievements.length })}</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Your medals")}</p>
          <div className="mt-2 flex gap-4">
            {MEDAL_ORDER.map((m) => (
              <div key={m} className="flex items-center gap-2">
                <span className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold tabular-nums shadow-sm ${MEDALS[m].badge}`}>
                  {summary.medals[m]}
                </span>
                <span className="text-xs text-[#6f675b]">{t(MEDALS[m].label)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Closest to the next medal")}</p>
          <ul className="mt-2 space-y-1.5">
            {summary.closest.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-[#1f1c17]">{t(a.label)}</span>
                <span className="shrink-0 text-[#6f675b]">{nextText(a)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {groups.map((group) => {
        const list = achievements.filter((a) => a.group === group);
        return (
          <section key={group}>
            <h2 className="mb-2 text-sm font-semibold text-[#1f1c17]">{t(group)}</h2>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {list.map((a) => (
                <li
                  key={a.id}
                  className={`flex gap-4 rounded-2xl border p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] ${
                    a.medal === "gold"
                      ? "border-amber-300 bg-gradient-to-br from-amber-50 to-white"
                      : a.medal === "none"
                        ? "border-dashed border-black/10 bg-white/60"
                        : "border-black/5 bg-white/90"
                  }`}
                >
                  <MedalRing a={a} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-snug text-[#1f1c17]">{t(a.label)}</p>
                    <p className="mt-0.5 text-[11px] text-[#8f8676]">
                      {t(a.hint)}
                      {a.detail ? ` · ${a.detail}` : ""}
                    </p>
                    <div className="mt-2 flex gap-1">
                      {MEDAL_ORDER.slice()
                        .reverse()
                        .map((m, i) => {
                          const got = a.n >= a.tiers[i];
                          return (
                            <span
                              key={m}
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${got ? MEDALS[m].badge : "bg-[#f3efe5] text-[#b0a79a]"}`}
                              title={t(MEDALS[m].label)}
                            >
                              {a.tiers[i].toLocaleString(locale)}
                            </span>
                          );
                        })}
                    </div>
                    <p className={`mt-1.5 text-[11px] ${a.medal === "gold" ? "font-semibold text-amber-700" : "text-[#6f675b]"}`}>
                      {a.medal === "gold" ? "★ " : ""}
                      {nextText(a)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
