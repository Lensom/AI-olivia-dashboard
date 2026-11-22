"use client";

import { useEffect, useMemo, useState } from "react";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { newId, STAGES, stageIndex, useCareer, type Application, type Stage } from "@/features/life/career/store";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const field = "min-w-0 rounded-lg border border-black/10 bg-white px-2 py-1 text-xs outline-none focus:border-black/25";
const today = () => new Date().toISOString().slice(0, 10);
const isWeb = (s: string) => /^https?:\/\/[^\s"'<>]+$/i.test(s.trim());

const CHANNELS: { value: Application["channel"]; label: string }[] = [
  { value: "referral", label: "Referral" },
  { value: "recruiter", label: "Recruiter" },
  { value: "direct", label: "Direct" },
  { value: "cold", label: "Cold" },
];

/** The guide's healthy conversions and what to do below them. Judged only from 5 applications in a step up. */
const STEPS: { from: Stage; to: Stage; label: string; healthy: [number, number]; healthyText: string; fix: string }[] = [
  { from: "applied", to: "recruiter", label: "Application → recruiter call", healthy: [10, 20], healthyText: "10–20% (with a referral clearly higher)", fix: "Переглядаємо CV, ключові слова і список компаній; більше рефералів" },
  { from: "recruiter", to: "technical", label: "Call → technical stage", healthy: [50, 100], healthyText: "50%+", fix: "Переписуємо pitch; часто це зарплатний фільтр, і тоді це нормально" },
  { from: "technical", to: "final", label: "Technical → final", healthy: [40, 50], healthyText: "40–50%", fix: "Просимо фідбек, додаємо mock-інтерв'ю саме на слабкий тип" },
  { from: "final", to: "offer", label: "Final → offer", healthy: [30, 50], healthyText: "30–50%", fix: "Працюємо над behavioral-історіями і «why us»" },
];
const MIN_FOR_VERDICT = 5;

type Sponsor = { company: string; ind: string; siri: string };

function AddForm() {
  const t = useT();
  const { update } = useCareer();
  const [a, setA] = useState({ company: "", role: "", url: "", wave: "" as Application["wave"], channel: "direct" as Application["channel"], applied: today() });
  const badUrl = a.url.trim() !== "" && !isWeb(a.url);
  function add() {
    if (!a.company.trim() || badUrl || !a.applied) return;
    const app: Application = { id: newId(), company: a.company.trim(), role: a.role.trim(), url: a.url.trim(), wave: a.wave, applied: a.applied, channel: a.channel, stage: "applied", closed: "", salary: "", sponsorship: "unknown", notes: "", job_id: "" };
    update(["applications"], (d) => ({ applications: [app, ...d.applications] }));
    setA({ ...a, company: "", role: "", url: "" });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
      className="flex flex-wrap gap-2"
    >
      <input value={a.company} onChange={(e) => setA({ ...a, company: e.target.value })} maxLength={200} placeholder={t("Company")} aria-label={t("Company")} className={`${field} flex-1 basis-32 py-1.5 text-sm`} />
      <input value={a.role} onChange={(e) => setA({ ...a, role: e.target.value })} maxLength={200} placeholder={t("Role")} aria-label={t("Role")} className={`${field} flex-1 basis-32 py-1.5 text-sm`} />
      <input value={a.url} onChange={(e) => setA({ ...a, url: e.target.value })} maxLength={2000} placeholder={t("Link (optional)")} aria-label={t("Link")} aria-invalid={badUrl} className={`${field} flex-1 basis-40 py-1.5 text-sm ${badUrl ? "border-rose-300" : ""}`} />
      <select value={a.wave} onChange={(e) => setA({ ...a, wave: e.target.value as Application["wave"] })} aria-label={t("Wave")} className={`${field} py-1.5 text-sm`}>
        <option value="">{t("Wave")}</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
      </select>
      <select value={a.channel} onChange={(e) => setA({ ...a, channel: e.target.value as Application["channel"] })} aria-label={t("Channel")} className={`${field} py-1.5 text-sm`}>
        {CHANNELS.map((c) => (
          <option key={c.value} value={c.value}>
            {t(c.label)}
          </option>
        ))}
      </select>
      <input type="date" value={a.applied} onChange={(e) => setA({ ...a, applied: e.target.value })} aria-label={t("Applied on")} className={`${field} py-1.5 text-sm`} />
      <button type="submit" disabled={!a.company.trim() || badUrl} className={`${investingToolbarBtn} disabled:opacity-40`}>
        {t("Add application")}
      </button>
    </form>
  );
}

function Row({ a, sponsor }: { a: Application; sponsor: Sponsor | undefined }) {
  const t = useT();
  const locale = useLocale();
  const { update } = useCareer();
  const [notes, setNotes] = useState(a.notes);
  const [salary, setSalary] = useState(a.salary);
  const patch = (p: Partial<Application>) => update(["applications"], (d) => ({ applications: d.applications.map((x) => (x.id === a.id ? { ...x, ...p } : x)) }));
  const closed = a.closed !== "";
  return (
    <li className={`space-y-2 py-3 ${closed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-[#1f1c17]">{a.company}</span>
        {a.wave ? <span className="rounded bg-[#f1ece2] px-1.5 text-[11px] font-semibold text-[#5f574b]">{a.wave}</span> : null}
        {sponsor?.ind ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800" title={sponsor.ind}>
            ✓ IND
          </span>
        ) : sponsor ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800" title={t("Not found under this name: the legal entity may be called something else.")}>
            {t("Not in IND register")}
          </span>
        ) : null}
        {a.role ? <span className="text-sm text-[#6f675b]">{a.role}</span> : null}
        {a.url ? (
          <a href={a.url} target="_blank" rel="noreferrer" className="text-sm text-[#2a78d6]" aria-label={t("Open vacancy")}>
            ↗
          </a>
        ) : null}
        <span className="ml-auto text-xs tabular-nums text-[#8f8676]">
          {new Date(`${a.applied}T00:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "UTC" })} · {t(CHANNELS.find((c) => c.value === a.channel)?.label ?? "")}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={a.stage} onChange={(e) => patch({ stage: e.target.value as Stage })} aria-label={t("Stage of {company}", { company: a.company })} className={field}>
          {STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.label)}
            </option>
          ))}
        </select>
        <select value={a.closed} onChange={(e) => patch({ closed: e.target.value as Application["closed"] })} aria-label={t("Outcome")} className={field}>
          <option value="">{a.stage === "offer" ? t("Offer") : t("Open")}</option>
          <option value="rejected">{t("Rejected")}</option>
          <option value="withdrawn">{t("Withdrew")}</option>
        </select>
        <select value={a.sponsorship} onChange={(e) => patch({ sponsorship: e.target.value as Application["sponsorship"] })} aria-label={t("Sponsorship")} className={field}>
          <option value="unknown">{t("Sponsorship: ?")}</option>
          <option value="yes">{t("Sponsors HSM")}</option>
          <option value="no">{t("No sponsorship")}</option>
        </select>
        <input
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
          onBlur={() => salary !== a.salary && patch({ salary: salary.trim() })}
          maxLength={100}
          placeholder={t("Salary range")}
          aria-label={t("Salary range")}
          className={`${field} w-32`}
        />
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t("Delete “{title}”?", { title: a.company }))) update(["applications"], (d) => ({ applications: d.applications.filter((x) => x.id !== a.id) }));
          }}
          className="ml-auto rounded px-1.5 text-xs text-[#8f8676] hover:bg-rose-50 hover:text-rose-700"
          aria-label={t("Delete “{title}”", { title: a.company })}
        >
          ✕
        </button>
      </div>
      <input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== a.notes && patch({ notes: notes.trim() })}
        maxLength={2000}
        placeholder={t("Notes: who you talked to, what's next")}
        aria-label={t("Notes")}
        className={`${field} w-full`}
      />
    </li>
  );
}

export default function CareerApplicationsPage() {
  const t = useT();
  const { token } = useAuth();
  const { data } = useCareer();
  const apps = data.applications;
  const [show, setShow] = useState<"open" | "all">("open");
  const [wave, setWave] = useState<Application["wave"] | "all">("all");
  const [sponsors, setSponsors] = useState<{ key: string; list: Sponsor[] } | null>(null);
  const companiesKey = useMemo(() => [...new Set(apps.map((a) => a.company))].sort().join("\n"), [apps]);

  useEffect(() => {
    if (!token || !companiesKey) return;
    let alive = true;
    apiFetch<Sponsor[]>("/life/career/sponsors", { token, method: "POST", body: JSON.stringify(companiesKey.split("\n")) })
      .then((list) => alive && setSponsors({ key: companiesKey, list }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, companiesKey]);
  const sponsorOf = (company: string) => sponsors?.list.find((s) => s.company === company);

  const reached = (s: Stage) => apps.filter((a) => stageIndex(a.stage) >= stageIndex(s)).length;
  const visible = apps
    .filter((a) => (show === "all" || a.closed === "") && (wave === "all" || a.wave === wave))
    .sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage) || b.applied.localeCompare(a.applied));
  const byChannel = CHANNELS.map((c) => {
    const list = apps.filter((a) => a.channel === c.value);
    return { ...c, n: list.length, calls: list.filter((a) => stageIndex(a.stage) >= 1).length };
  }).filter((c) => c.n);

  return (
    <div className="space-y-5">
      <section className={card} aria-labelledby="funnel-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="funnel-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("Funnel")}
          </h2>
          <span className="text-xs text-[#8f8676]">{t("Healthy rates are the guide's estimates, not statistics.")}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STAGES.map((s) => (
            <div key={s.value} className="rounded-xl bg-[#faf8f2] px-3 py-2">
              <p className="text-[11px] text-[#8f8676]">{t(s.label)}</p>
              <p className="text-xl font-semibold tabular-nums text-[#1f1c17]">{reached(s.value)}</p>
            </div>
          ))}
        </div>
        <ul className="mt-3 divide-y divide-black/5">
          {STEPS.map((step) => {
            const from = reached(step.from);
            const to = reached(step.to);
            const pct = from ? Math.round((to / from) * 100) : null;
            const judged = from >= MIN_FOR_VERDICT && pct != null;
            const low = judged && pct < step.healthy[0];
            return (
              <li key={step.from} className="py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`h-2 w-2 rounded-full ${!judged ? "bg-[#ddd5c6]" : low ? "bg-rose-500" : "bg-emerald-500"}`} aria-hidden />
                  <span className="flex-1 text-[#1f1c17]">{t(step.label)}</span>
                  <span className="tabular-nums text-[#1f1c17]">{pct != null ? `${pct}%` : "—"}</span>
                  <span className="w-44 text-right text-xs text-[#8f8676]">{t("healthy: {v}", { v: t(step.healthyText) })}</span>
                </div>
                {low ? <p className="ml-4 mt-0.5 text-xs text-rose-800">{step.fix}</p> : null}
                {!judged && from > 0 ? <p className="ml-4 mt-0.5 text-xs text-[#8f8676]">{t("Too few yet to judge ({n} of {min}).", { n: from, min: MIN_FOR_VERDICT })}</p> : null}
              </li>
            );
          })}
        </ul>
        {byChannel.length ? (
          <p className="mt-2 text-xs text-[#6f675b]">
            {t("By channel:")} {byChannel.map((c) => `${t(c.label)} ${c.n} → ${t("{n} calls", { n: c.calls })}`).join(" · ")}
          </p>
        ) : null}
      </section>

      <section className={card} aria-labelledby="apps-title">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="apps-title" className="mr-auto text-sm font-semibold text-[#1f1c17]">
            {t("Applications")} <span className="font-normal text-[#8f8676]">· {apps.length}</span>
          </h2>
          <select value={show} onChange={(e) => setShow(e.target.value as "open" | "all")} aria-label={t("Show")} className={field}>
            <option value="open">{t("In progress")}</option>
            <option value="all">{t("All, closed too")}</option>
          </select>
          <select value={wave} onChange={(e) => setWave(e.target.value as Application["wave"] | "all")} aria-label={t("Wave")} className={field}>
            <option value="all">{t("All waves")}</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </div>
        <div className="mt-3">
          <AddForm />
        </div>
        {visible.length ? (
          <ul className="mt-2 divide-y divide-black/5">
            {visible.map((a) => (
              <Row key={a.id} a={a} sponsor={sponsorOf(a.company)} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[#8f8676]">{apps.length ? t("Nothing open with these filters.") : t("No applications yet. Add the first one above, or mark a vacancy “Applied” on the Jobs page.")}</p>
        )}
      </section>
    </div>
  );
}
