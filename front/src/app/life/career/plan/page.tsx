"use client";

import { useState } from "react";
import { AFTER_OFFER, NO_OFFER_BY_FEB, PHASES, PLAN, PLAN_GOAL, weekFor, WEEKLY_BASE } from "@/features/life/career/plan";
import { useCareer } from "@/features/life/career/store";
import { useLocale, useT } from "@/lib/i18n";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";
const today = () => new Date().toISOString().slice(0, 10);

export default function CareerPlanPage() {
  const t = useT();
  const locale = useLocale();
  const { data, update } = useCareer();
  const [day] = useState(today);
  const current = weekFor(day).week;
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const toggle = (id: string) =>
    update(["checks"], (d) => {
      const checks = { ...d.checks };
      if (checks[id]) delete checks[id];
      else checks[id] = true;
      return { checks };
    });

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#6f675b]">{PLAN_GOAL}</p>

      <section className={card}>
        <h2 className="text-sm font-semibold text-[#9a3b2e]">{t("Every week (except the holidays)")}</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="text-[11px] text-[#8f8676]">
              <tr>
                <th className="py-1 pr-3 font-medium">{t("What")}</th>
                <th className="py-1 pr-3 font-medium">{t("How much")}</th>
                <th className="py-1 font-medium">{t("How")}</th>
              </tr>
            </thead>
            <tbody>
              {WEEKLY_BASE.map((b) => (
                <tr key={b.key} className="border-t border-black/5 align-top">
                  <td className="py-1.5 pr-3 text-[#1f1c17]">{b.what}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-[#1f1c17]">{b.target}</td>
                  <td className="py-1.5 text-[#6f675b]">{b.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {[1, 2, 3].map((phase) => (
        <section key={phase} className="space-y-3">
          <h2 className="text-base font-semibold text-[#9a3b2e]">{PHASES[phase].title}</h2>
          {PLAN.filter((w) => w.phase === phase).map((w) => {
            const items = w.groups.flatMap((g) => g.items);
            const done = items.filter((i) => data.checks[i.id]).length;
            const isNow = w === current;
            const past = w.to < day;
            return (
              <details key={w.id} open={isNow} className={`${card} ${isNow ? "ring-2 ring-[#1f1c17]/80" : ""} ${w.light ? "border-l-4 border-l-sky-500" : "border-l-4 border-l-[#9a3b2e]"}`}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-[#1f1c17]">{w.label}</span>
                  {isNow ? <span className="rounded-full bg-[#1f1c17] px-2 py-0.5 text-[11px] font-semibold text-[#f8f4eb]">{t("Now")}</span> : null}
                  <span className="text-sm text-[#6f675b]">{w.goal}</span>
                  <span className="ml-auto text-xs tabular-nums text-[#8f8676]">
                    {fmt(w.from)} – {fmt(w.to)} · {done}/{items.length}
                    {past && done < items.length ? ` · ${t("{n} left", { n: items.length - done })}` : ""}
                  </span>
                </summary>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {w.groups.map((g) => (
                    <div key={g.title}>
                      <p className={label}>{g.title}</p>
                      <ul className="mt-1.5 space-y-1">
                        {g.items.map((i) => (
                          <li key={i.id}>
                            <label className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-[#faf8f2]">
                              <input type="checkbox" checked={!!data.checks[i.id]} onChange={() => toggle(i.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
                              <span className={data.checks[i.id] ? "text-[#8f8676] line-through decoration-emerald-600/50" : "text-[#1f1c17]"}>{i.text}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                {w.checkpoint ? <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2 text-sm text-[#1f3b52]">{w.checkpoint.text}</p> : null}
              </details>
            );
          })}
        </section>
      ))}

      <section className={card}>
        <h2 className="text-base font-semibold text-[#9a3b2e]">{t("Phase 4. From the offer to moving (~6–8 weeks)")}</h2>
        <table className="mt-2 w-full text-left text-sm">
          <tbody>
            {AFTER_OFFER.map(([when, what]) => (
              <tr key={when} className="border-t border-black/5 align-top first:border-t-0">
                <td className="w-44 py-1.5 pr-3 font-medium text-[#1f1c17]">{when}</td>
                <td className="py-1.5 text-[#3b352d]">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-[#9a3b2e]">{t("If there's no offer by 14.02")}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#3b352d]">
          {NO_OFFER_BY_FEB.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[#8f8676]">{t("Check the HSM salary thresholds and tax rules on ind.nl and belastingdienst.nl.")}</p>
      </section>
    </div>
  );
}
