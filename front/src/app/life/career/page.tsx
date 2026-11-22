"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { addDays, mondayOf, PHASES, PLAN, weekFor, WEEKLY_BASE, type PlanWeek } from "@/features/life/career/plan";
import { ROADMAP, TRACKS } from "@/features/life/career/roadmap";
import { newId, stageIndex, useCareer, type Application, type WeekCounts } from "@/features/life/career/store";
import { useLocale, useT } from "@/lib/i18n";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_COUNTS: WeekCounts = { messages: 0, mock: 0, post: 0, funnel: false };

function Counter({ value, onChange, label: name }: { value: number; onChange: (n: number) => void; label: string }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1">
      <button type="button" onClick={() => onChange(Math.max(0, value - 1))} disabled={!value} aria-label={t("One less: {what}", { what: name })} className="h-7 w-7 rounded-full border border-black/10 bg-white text-sm text-[#3b352d] hover:bg-[#faf8f2] disabled:opacity-30">
        −
      </button>
      <span className="w-6 text-center text-sm font-semibold tabular-nums text-[#1f1c17]">{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} aria-label={t("One more: {what}", { what: name })} className="h-7 w-7 rounded-full border border-black/10 bg-white text-sm text-[#3b352d] hover:bg-[#faf8f2]">
        +
      </button>
    </span>
  );
}

/** Done, on track or not yet, against a target like 8–10. */
function Tone({ n, min }: { n: number; min: number }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${n >= min ? "bg-emerald-500" : n > 0 ? "bg-amber-400" : "bg-[#ddd5c6]"}`} aria-hidden />;
}

function QuickApply({ day }: { day: string }) {
  const t = useT();
  const { update } = useCareer();
  const [company, setCompany] = useState("");
  const [wave, setWave] = useState<Application["wave"]>("");
  const [channel, setChannel] = useState<Application["channel"]>("direct");
  function add() {
    const name = company.trim();
    if (!name) return;
    const a: Application = { id: newId(), company: name, role: "", url: "", wave, applied: day, channel, stage: "applied", closed: "", salary: "", sponsorship: "unknown", notes: "", job_id: "" };
    update(["applications"], (d) => ({ applications: [a, ...d.applications] }));
    setCompany("");
  }
  const field = "rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/25";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="flex flex-wrap gap-2"
    >
      <input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} placeholder={t("Company you applied to")} aria-label={t("Company")} className={`${field} min-w-0 flex-1 basis-40`} />
      <select value={wave} onChange={(e) => setWave(e.target.value as Application["wave"])} aria-label={t("Wave")} className={field}>
        <option value="">{t("Wave")}</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
      </select>
      <select value={channel} onChange={(e) => setChannel(e.target.value as Application["channel"])} aria-label={t("Channel")} className={field}>
        <option value="referral">{t("Referral")}</option>
        <option value="recruiter">{t("Recruiter")}</option>
        <option value="direct">{t("Direct")}</option>
        <option value="cold">{t("Cold")}</option>
      </select>
      <button type="submit" disabled={!company.trim()} className={`${investingToolbarBtn} disabled:opacity-40`}>
        {t("Add application")}
      </button>
    </form>
  );
}

function Checkpoint({ week, apps }: { week: PlanWeek; apps: Application[] }) {
  const t = useT();
  const cp = week.checkpoint!;
  const by = apps.filter((a) => a.applied <= cp.date);
  const calls = by.filter((a) => stageIndex(a.stage) >= stageIndex("recruiter")).length;
  const ok = by.length >= cp.applications[0] && (!cp.calls || calls >= cp.calls[0]);
  return (
    <section className={`rounded-2xl border p-4 ${ok ? "border-emerald-200 bg-emerald-50" : "border-sky-200 bg-sky-50"}`}>
      <p className="text-sm text-[#1f3b52]">{cp.text}</p>
      <p className="mt-2 text-sm font-semibold tabular-nums text-[#1f1c17]">
        {t("You: {n} applications", { n: by.length })}
        {cp.calls ? ` · ${t("{n} recruiter calls", { n: calls })}` : ""}
      </p>
    </section>
  );
}

export default function CareerThisWeekPage() {
  const t = useT();
  const locale = useLocale();
  const { data, update } = useCareer();
  const [day] = useState(today);
  const current = weekFor(day);
  const [index, setIndex] = useState(() => PLAN.indexOf(current.week));
  const week = PLAN[index];
  const viewingCurrent = week === current.week;
  // Counts belong to a calendar week: this one when looking at the current plan week, else that week's first.
  const monday = viewingCurrent && current.state === "during" ? mondayOf(day) : mondayOf(week.from);
  const sunday = addDays(monday, 6);
  const counts = data.weeks[monday] ?? EMPTY_COUNTS;
  const appsThisWeek = data.applications.filter((a) => a.applied >= monday && a.applied <= sunday);
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const daysToStart = Math.round((Date.parse(`${week.from}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);

  const setCounts = (patch: Partial<WeekCounts>) => update(["weeks"], (d) => ({ weeks: { ...d.weeks, [monday]: { ...(d.weeks[monday] ?? EMPTY_COUNTS), ...patch } } }));
  const toggle = (id: string) =>
    update(["checks"], (d) => {
      const checks = { ...d.checks };
      if (checks[id]) delete checks[id];
      else checks[id] = true;
      return { checks };
    });

  const topics = useMemo(() => ROADMAP.filter((tp) => tp.from && tp.to && tp.from <= week.to && tp.to >= week.from), [week]);
  const items = week.groups.flatMap((g) => g.items);
  const ticked = items.filter((i) => data.checks[i.id]).length;
  const base = (key: (typeof WEEKLY_BASE)[number]["key"]) => WEEKLY_BASE.find((b) => b.key === key)!;

  return (
    <div className="space-y-5">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setIndex(index - 1)} disabled={index === 0} aria-label={t("Previous week")} className={`${investingToolbarBtn} disabled:opacity-30`}>
            ←
          </button>
          <div className="min-w-0 flex-1">
            <p className={label}>{PHASES[week.phase].title}</p>
            <h2 className="text-xl font-semibold text-[#1f1c17]">
              {week.label} <span className="whitespace-nowrap text-sm font-normal text-[#8f8676]">{fmt(week.from)} – {fmt(week.to)}</span>
            </h2>
            <div className="mt-1">
              {viewingCurrent ? (
                <span className="inline-block rounded-full bg-[#1f1c17] px-2.5 py-0.5 text-[11px] font-semibold text-[#f8f4eb]">
                  {current.state === "before" ? (daysToStart === 1 ? t("Starts tomorrow") : t("Starts in {n} days", { n: daysToStart })) : current.state === "after" ? t("The plan is over") : t("Now")}
                </span>
              ) : (
                <button type="button" onClick={() => setIndex(PLAN.indexOf(current.week))} className="text-xs text-[#2a78d6] hover:underline">
                  {t("Back to this week")}
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={() => setIndex(index + 1)} disabled={index === PLAN.length - 1} aria-label={t("Next week")} className={`${investingToolbarBtn} disabled:opacity-30`}>
            →
          </button>
        </div>
        <p className="mt-3 text-sm font-semibold text-[#9a3b2e]">{t("Goal: {goal}", { goal: week.goal })}</p>
        <p className="mt-1 text-xs tabular-nums text-[#8f8676]">{t("{d} of {n} done", { d: ticked, n: items.length })}</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {week.groups.map((g) => (
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
      </section>

      {week.checkpoint ? <Checkpoint week={week} apps={data.applications} /> : null}

      <section className={card} aria-labelledby="rhythm-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="rhythm-title" className="text-sm font-semibold text-[#1f1c17]">
            {week.light ? t("The week's rhythm (holidays: light)") : t("The week's rhythm")}
          </h2>
          <span className="text-xs text-[#8f8676]">
            {fmt(monday)} – {fmt(sunday)}
          </span>
        </div>
        <ul className="mt-3 divide-y divide-black/5">
          <li className="space-y-2 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <Tone n={appsThisWeek.length} min={week.applications[0]} />
              <span className="flex-1 text-sm font-medium text-[#1f1c17]">{base("applications").what}</span>
              <span className="text-sm tabular-nums text-[#3b352d]">
                <b>{appsThisWeek.length}</b> / {week.applications[0] === week.applications[1] ? week.applications[0] : `${week.applications[0]}–${week.applications[1]}`}
              </span>
            </div>
            <p className="text-xs text-[#8f8676]">{base("applications").how}</p>
            {appsThisWeek.length ? <p className="text-xs text-[#6f675b]">{appsThisWeek.map((a) => a.company).join(", ")}</p> : null}
            <QuickApply day={day >= monday && day <= sunday ? day : monday} />
          </li>
          {(
            [
              ["messages", week.light ? 0 : 5],
              ["mock", week.light ? 0 : 1],
              ["post", week.light ? 0 : 1],
            ] as const
          ).map(([key, target]) => (
            <li key={key} className="flex flex-wrap items-center gap-2 py-2.5">
              <Tone n={counts[key]} min={target || 1} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[#1f1c17]">{base(key).what}</span>
                <span className="block text-xs text-[#8f8676]">{base(key).how}</span>
              </span>
              <Counter value={counts[key]} onChange={(n) => setCounts({ [key]: n })} label={base(key).what} />
              <span className="w-8 text-right text-xs tabular-nums text-[#8f8676]">{target ? `/ ${target}` : "—"}</span>
            </li>
          ))}
          <li className="flex flex-wrap items-center gap-2 py-2.5">
            <Tone n={counts.funnel ? 1 : 0} min={1} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-[#1f1c17]">{base("funnel").what}</span>
              <span className="block text-xs text-[#8f8676]">{base("funnel").how}</span>
            </span>
            <Link href="/life/career/applications" className="text-xs text-[#2a78d6] hover:underline">
              {t("Funnel →")}
            </Link>
            <label className="flex items-center gap-1.5 text-xs text-[#3b352d]">
              <input type="checkbox" checked={counts.funnel} onChange={(e) => setCounts({ funnel: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
              {t("Done")}
            </label>
          </li>
        </ul>
      </section>

      {topics.length ? (
        <section className={card} aria-labelledby="learn-title">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="learn-title" className="text-sm font-semibold text-[#1f1c17]">
              {t("Learning this week")} <span className="font-normal text-[#8f8676]">· {base("learning").target}</span>
            </h2>
            <Link href="/life/career/learning" className="text-xs text-[#2a78d6] hover:underline">
              {t("All of the roadmap →")}
            </Link>
          </div>
          <ul className="mt-2 space-y-2">
            {topics.map((tp) => {
              const done = tp.items.filter((i) => data.progress[i.id] === 2).length;
              const doing = tp.items.filter((i) => data.progress[i.id] === 1).length;
              return (
                <li key={tp.title} className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${TRACKS[tp.track].tag}`}>{TRACKS[tp.track].label}</span>
                  <span className="min-w-0 flex-1 text-sm text-[#1f1c17]">{tp.title}</span>
                  <span className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-[#ece6da] sm:block" aria-hidden>
                    <span className="block h-full bg-emerald-600" style={{ width: `${(done / tp.items.length) * 100}%` }} />
                  </span>
                  <span className="w-20 text-right text-xs tabular-nums text-[#6f675b]">
                    {done}/{tp.items.length}
                    {doing ? ` · ${doing}…` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
