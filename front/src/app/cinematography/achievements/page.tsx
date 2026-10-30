"use client";

import { useMemo } from "react";
import { byNextMedal, GROUPS, MedalRing, MEDALS, useAchievements, useNextText, type Medal } from "@/features/cinema/achievements";
import { useLocale, useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const MEDAL_ORDER: Medal[] = ["gold", "silver", "bronze"];

export default function CinemaAchievementsPage() {
  const t = useT();
  const locale = useLocale();
  const { isLoaded, loadError } = useCinema();
  const { achievements } = useAchievements();
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

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;

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

      {GROUPS.map((group) => {
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
