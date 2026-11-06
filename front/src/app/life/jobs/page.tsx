"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { investingPrimarySaveActive, investingPrimarySaveDisabled, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { apiFetch, type ApiError } from "@/lib/api";
import { useLang, useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

/** Mirrors back/app/jobs/router.py. */
type JobStatus = "new" | "interesting" | "applied" | "interview" | "rejected" | "hidden";
type Job = {
  id: string;
  source: string;
  title: string;
  company: string;
  location: string;
  country: string;
  url: string;
  posted: string;
  status: JobStatus;
  first_seen: string;
  still_listed: boolean;
  visa_stated: boolean;
  sponsor: { name: string; registry: string } | null;
  relocation: "offered" | "not_mentioned" | "not_offered" | null;
  language: "english_ok" | "local_required" | "unclear" | null;
  match: number | null;
  summary: string;
  strengths: string[];
  gaps: string[];
  title_only: boolean;
  assessed: boolean;
};
type SourceStatus = { source: string; ok: boolean; found: number; error: string };
type JobsState = {
  cv: { name: string; characters: number; updated_at: string } | null;
  last_refresh_at: string | null;
  sources: SourceStatus[];
  jobs: Job[];
  unassessed: number;
};

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

const STATUSES: { value: JobStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "interesting", label: "Interesting" },
  { value: "applied", label: "Applied" },
  { value: "interview", label: "Interview" },
  { value: "rejected", label: "Rejected" },
  { value: "hidden", label: "Hidden" },
];
const COUNTRIES = [
  { value: "all", label: "All countries" },
  { value: "NL", label: "Netherlands" },
  { value: "NO", label: "Norway" },
  { value: "DK", label: "Denmark" },
];
const SOURCE_NAMES: Record<string, string> = { companies: "Company career pages", nav: "NAV", visajobs: "VisaJobs", relocate: "Relocate.me", eures: "EURES", ind: "IND register", siri: "SIRI register" };
const COUNTRY_NAMES: Record<string, string> = { NL: "Netherlands", NO: "Norway", DK: "Denmark" };

function Pill({ tone, children }: { tone: "good" | "warn" | "bad" | "plain"; children: React.ReactNode }) {
  const cls = {
    good: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-800",
    bad: "bg-rose-50 text-rose-800",
    plain: "bg-[#f4efe4] text-[#6f675b]",
  }[tone];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function matchTone(match: number): string {
  if (match >= 70) return "bg-emerald-600 text-white";
  if (match >= 45) return "bg-amber-100 text-amber-900";
  return "bg-[#f4efe4] text-[#6f675b]";
}

function JobCard({ job, onStatus }: { job: Job; onStatus: (status: JobStatus) => void }) {
  const t = useT();
  const locale = useLocale();
  const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const local = job.language === "local_required" && job.match == null;
  return (
    <li className={`${card} ${job.status === "hidden" ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-[#1f1c17]">
            <a href={job.url} target="_blank" rel="noreferrer" className="hover:underline" title={t("Open vacancy")}>
              {job.title} <span aria-hidden className="font-normal text-[#2a78d6]">↗</span>
            </a>
          </h3>
          <p className="mt-0.5 text-xs text-[#6f675b]">
            {[job.company || t("Employer not named"), job.location && !job.location.toLowerCase().includes((COUNTRY_NAMES[job.country] ?? "").toLowerCase()) ? `${job.location} · ${t(COUNTRY_NAMES[job.country] ?? "")}` : job.location].filter(Boolean).join(" · ")}
          </p>
        </div>
        {job.match != null ? (
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums ${matchTone(job.match)}`}>{t("{n} match", { n: `${job.match}%` })}</span>
        ) : !job.assessed ? (
          <span className="shrink-0 text-[11px] text-[#8f8676]">{t("Not assessed")}</span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {job.relocation === "offered" ? <Pill tone="good">✓ {t("Relocation offered")}</Pill> : null}
        {job.relocation === "not_mentioned" ? <Pill tone="plain">{t("Relocation not mentioned")}</Pill> : null}
        {job.relocation === "not_offered" ? <Pill tone="bad">✕ {t("No relocation")}</Pill> : null}
        {job.visa_stated ? <Pill tone="good">✓ {t("Visa sponsorship")}</Pill> : null}
        {job.sponsor ? <Pill tone="good">✓ {t("Company can sponsor a visa")} · {job.sponsor.name} ({job.sponsor.registry})</Pill> : null}
        {job.language === "english_ok" ? <Pill tone="good">✓ {t("English is enough")}</Pill> : null}
        {job.language === "local_required" ? <Pill tone="bad">✕ {t("Local language required")}</Pill> : null}
        {job.language === "unclear" ? <Pill tone="warn">{t("Language unclear")}</Pill> : null}
        {!job.still_listed ? <Pill tone="warn">{t("No longer listed")}</Pill> : null}
      </div>

      {job.summary ? <p className="mt-2 text-xs leading-relaxed text-[#3b352d]">{job.summary}</p> : null}
      {local ? <p className="mt-2 text-xs text-[#8f8676]">{t("Written in the local language, so it wasn’t scored.")}</p> : null}
      {job.strengths.length || job.gaps.length ? (
        <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2 [&>*]:min-w-0">
          {job.strengths.length ? (
            <div>
              <p className={label}>{t("What fits")}</p>
              <ul className="mt-1 space-y-0.5 text-xs leading-snug text-[#3b352d]">
                {job.strengths.map((s) => (
                  <li key={s} className="flex gap-1.5"><span aria-hidden className="text-emerald-600">+</span>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {job.gaps.length ? (
            <div>
              <p className={label}>{t("What’s missing")}</p>
              <ul className="mt-1 space-y-0.5 text-xs leading-snug text-[#3b352d]">
                {job.gaps.map((s) => (
                  <li key={s} className="flex gap-1.5"><span aria-hidden className="text-rose-600">−</span>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {job.title_only && job.match != null ? <p className="mt-2 text-[11px] text-[#8f8676]">{t("The ad gave few details, so this rests mostly on the title.")}</p> : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-black/5 pt-2.5">
        <p className="text-[11px] tabular-nums text-[#8f8676]">
          {[job.posted ? t("Posted {when}", { when: day(job.posted) }) : t("Found {when}", { when: day(job.first_seen) }), t(SOURCE_NAMES[job.source] ?? "Company career pages")].join(" · ")}
        </p>
        <select
          value={job.status}
          onChange={(e) => onStatus(e.target.value as JobStatus)}
          aria-label={`${t("Vacancy status")}: ${job.title}`}
          className="rounded-lg border border-black/10 bg-white px-2 py-1 text-xs font-medium text-[#3b352d] outline-none focus:border-black/25"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{t(s.label)}</option>
          ))}
        </select>
      </div>
    </li>
  );
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[#3b352d]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-3.5 w-3.5 accent-[#1f1c17]" />
      {children}
    </label>
  );
}

const inputCls = "rounded-full border border-black/10 bg-white px-3 py-1.5 text-xs font-medium text-[#3b352d] outline-none focus:border-black/25";

function JobsPage() {
  const { token } = useAuth();
  const t = useT();
  const locale = useLocale();
  const [lang] = useLang();
  const [state, setState] = useState<JobsState | null>(null);
  const [busy, setBusy] = useState<"refresh" | "cv" | null>(null);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [englishOnly, setEnglishOnly] = useState(true);
  const [relocationOnly, setRelocationOnly] = useState(false);
  const [sponsorOnly, setSponsorOnly] = useState(false);
  const [sort, setSort] = useState<"match" | "newest">("match");
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const scoringRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const message = useCallback(
    (err: unknown) => {
      const e = err as ApiError;
      return e.status === 0 ? t("Can’t reach the server") : e.message || t("Something went wrong — try again.");
    },
    [t],
  );

  /** Small batches until none are left; stops at the first error, and "Continue" picks up where it ended. */
  const assess = useCallback(async () => {
    if (!token || scoringRef.current) return;
    scoringRef.current = true;
    setScoring(true);
    try {
      let left = Infinity;
      while (alive.current) {
        const next = await apiFetch<JobsState>(`/life/jobs/score?lang=${lang}`, { method: "POST", token });
        if (!alive.current) return;
        setState(next);
        if (next.unassessed === 0 || next.unassessed >= left) return; // no progress: don't loop on the same ones
        left = next.unassessed;
      }
    } catch (err) {
      if (alive.current) setError(message(err));
    } finally {
      scoringRef.current = false;
      if (alive.current) setScoring(false);
    }
  }, [token, lang, message]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    apiFetch<JobsState>("/life/jobs", { token })
      .then((data) => {
        if (active) setState(data);
      })
      .catch((err) => {
        if (active) setError(message(err));
      });
    return () => {
      active = false;
    };
  }, [token, message]);

  async function refresh() {
    if (!token) return;
    setBusy("refresh");
    setError(null);
    try {
      const next = await apiFetch<JobsState>("/life/jobs/refresh", { method: "POST", token });
      setState(next);
      if (next.cv && next.unassessed) void assess();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function uploadCv(file: File) {
    if (!token) return;
    setBusy("cv");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const next = await apiFetch<JobsState>("/life/jobs/cv", { method: "POST", token, body });
      setState(next);
      if (next.unassessed) void assess();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function deleteCv() {
    if (!token) return;
    setError(null);
    try {
      setState(await apiFetch<JobsState>("/life/jobs/cv", { method: "DELETE", token }));
    } catch (err) {
      setError(message(err));
    }
  }

  async function setStatus(job: Job, status: JobStatus) {
    if (!token) return;
    const before = state;
    setState((s) => (s ? { ...s, jobs: s.jobs.map((j) => (j.id === job.id ? { ...j, status } : j)) } : s));
    try {
      await apiFetch(`/life/jobs/${job.id}`, { method: "PATCH", token, body: JSON.stringify({ status }) });
    } catch (err) {
      setState(before);
      setError(message(err));
    }
  }

  const jobs = useMemo(() => state?.jobs ?? [], [state]);
  const visible = useMemo(() => {
    const list = jobs.filter((j) => {
      if (country !== "all" && j.country !== country) return false;
      if (statusFilter === "active" ? j.status === "hidden" || j.status === "rejected" : statusFilter !== "all" && j.status !== statusFilter) return false;
      if (englishOnly && j.language === "local_required") return false;
      if (relocationOnly && j.relocation !== "offered") return false;
      if (sponsorOnly && !j.sponsor) return false;
      return true;
    });
    const date = (j: Job) => j.posted || j.first_seen.slice(0, 10);
    // A great fit that refuses to sponsor you isn't a real option: those go below the ones still possible.
    const blocked = (j: Job) => (j.relocation === "not_offered" ? 1 : 0);
    return [...list].sort((a, b) =>
      sort === "match"
        ? blocked(a) - blocked(b) || (b.match ?? -1) - (a.match ?? -1) || date(b).localeCompare(date(a))
        : date(b).localeCompare(date(a)),
    );
  }, [jobs, country, statusFilter, englishOnly, relocationOnly, sponsorOnly, sort]);

  const when = (iso: string) => new Date(iso).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const pending = state?.unassessed ?? 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#655d51]">{t("Front-end vacancies with relocation to the Netherlands, Norway and Denmark, checked against your CV.")}</p>

      <section className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("Your CV")}</h2>
          <p className="mt-0.5 break-words text-xs text-[#6f675b]">
            {state?.cv ? t("{name} · updated {when}", { name: state.cv.name, when: when(state.cv.updated_at) }) : t("Upload a PDF. Only its text is kept, and it’s sent to Google Gemini to match vacancies.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            aria-label={t("Upload CV (PDF)")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadCv(file);
            }}
          />
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy === "cv"} className={state?.cv ? investingToolbarBtn : investingPrimarySaveActive}>
            {busy === "cv" ? t("Uploading…") : state?.cv ? t("Replace") : t("Upload CV (PDF)")}
          </button>
          {state?.cv ? (
            <button type="button" onClick={() => void deleteCv()} className="rounded-full px-2.5 py-1.5 text-xs font-medium text-[#6f675b] hover:bg-black/5">
              {t("Delete CV")}
            </button>
          ) : null}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void refresh()} disabled={busy === "refresh"} className={busy === "refresh" ? investingPrimarySaveDisabled : investingPrimarySaveActive}>
            {busy === "refresh" ? t("Refreshing…") : t("Refresh vacancies")}
          </button>
          {state?.last_refresh_at ? <span className="text-xs text-[#8f8676]">{t("Last refreshed {when}", { when: when(state.last_refresh_at) })}</span> : null}
        </div>
        {state?.sources.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("Sources")}>
            {state.sources.map((s) => {
              const name = t(SOURCE_NAMES[s.source] ?? s.source);
              return (
                <li key={s.source} title={s.error || undefined}>
                  <Pill tone={s.ok && !s.error ? "plain" : "warn"}>{s.ok ? t("{source}: {n} found", { source: name, n: s.found }) : t("{source}: failed", { source: name })}</Pill>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{error}</p>
      ) : null}

      {scoring ? (
        <p className="flex items-center gap-2 text-xs text-[#6f675b]" role="status">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden />
          {t("Assessing vacancies against your CV: {n} left…", { n: pending })}
        </p>
      ) : state?.cv && pending ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[#6f675b]">
          {t("{n} vacancies aren’t assessed yet.", { n: pending })}
          <button type="button" onClick={() => void assess()} className="font-semibold text-[#2a78d6] hover:underline">{t("Continue assessing")}</button>
        </p>
      ) : !state?.cv && jobs.length ? (
        <p className="text-xs text-[#6f675b]">{t("Upload your CV to get a match score for each vacancy.")}</p>
      ) : null}

      {jobs.length ? (
        <section className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={t("Country")} className={inputCls}>
            {COUNTRIES.map((c) => <option key={c.value} value={c.value}>{t(c.label)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t("Vacancy status")} className={inputCls}>
            <option value="active">{t("In progress")}</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{t(s.label)}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as "match" | "newest")} aria-label={t("Sort")} className={inputCls}>
            <option value="match">{t("Best match")}</option>
            <option value="newest">{t("Newest")}</option>
          </select>
          <Toggle checked={englishOnly} onChange={setEnglishOnly}>{t("English only")}</Toggle>
          <Toggle checked={relocationOnly} onChange={setRelocationOnly}>{t("Relocation confirmed")}</Toggle>
          <Toggle checked={sponsorOnly} onChange={setSponsorOnly}>{t("Company can sponsor")}</Toggle>
          <span className="ml-auto text-xs tabular-nums text-[#8f8676]">{t("{n} of {total} vacancies", { n: visible.length, total: jobs.length })}</span>
          <p className="w-full text-xs leading-relaxed text-[#8f8676]">{t("“Can sponsor” means the company is on an official register: IND for the Netherlands, SIRI for Denmark. Norway has no such list. It doesn’t promise a visa for this role, and a company that isn’t marked may still sponsor under another legal name.")}</p>
        </section>
      ) : null}

      {state && !jobs.length ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`}>{t("Press Refresh vacancies to find the first ones.")}</p>
      ) : !state && !error ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`} role="status">{t("Loading…")}</p>
      ) : jobs.length && !visible.length ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`}>{t("No vacancies match these filters.")}</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((job) => <JobCard key={job.id} job={job} onStatus={(status) => void setStatus(job, status)} />)}
        </ul>
      )}
    </div>
  );
}

export default function JobsRoutePage() {
  return (
    <RequireAuth>
      <JobsPage />
    </RequireAuth>
  );
}
