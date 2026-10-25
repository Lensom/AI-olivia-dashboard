"use client";

import { useEffect, useState } from "react";
import { dashCard } from "@/features/investing/dashboard/widgets";
import { formatUsd } from "@/features/investing/format";
import { Bullets, modelName, SparkIcon } from "@/features/investing/watchlist/ai-analysis";
import { apiFetch, type ApiError } from "@/lib/api";
import { useLang, useLocale, useT } from "@/lib/i18n";

type Health = "strong" | "good" | "needs_attention" | "at_risk";
type Move = "buy" | "add" | "hold" | "trim" | "sell" | "rebalance" | "watch";

type PortfolioAnalysis = {
  health: Health;
  confidence: "low" | "medium" | "high";
  headline: string;
  summary: string;
  diversification: string;
  performance: string;
  valuation_risk: string;
  strengths: string[];
  risks: string[];
  actions: { action: Move; ticker: string; detail: string }[];
  cash_plan: string;
};

type PortfolioAnalysisResponse = {
  analysis: PortfolioAnalysis;
  model: string;
  lang: string;
  account_value: number | null;
  created_at: string;
};

const HEALTH: Record<Health, { label: string; cls: string }> = {
  strong: { label: "In great shape", cls: "bg-emerald-600 text-white" },
  good: { label: "Good shape", cls: "bg-emerald-100 text-emerald-800" },
  needs_attention: { label: "Needs attention", cls: "bg-amber-100 text-amber-800" },
  at_risk: { label: "At risk", cls: "bg-rose-100 text-rose-800" },
};

const MOVES: Record<Move, { label: string; cls: string }> = {
  buy: { label: "Buy now", cls: "bg-emerald-100 text-emerald-800" },
  add: { label: "Add more", cls: "bg-emerald-100 text-emerald-800" },
  hold: { label: "Keep holding", cls: "bg-sky-100 text-sky-800" },
  trim: { label: "Trim", cls: "bg-orange-100 text-orange-800" },
  sell: { label: "Sell position", cls: "bg-rose-100 text-rose-800" },
  rebalance: { label: "Rebalance", cls: "bg-violet-100 text-violet-800" },
  watch: { label: "Watch", cls: "bg-amber-100 text-amber-800" },
};

const CONFIDENCE = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" } as const;

const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

/** Overview card: Gemini's review of the whole portfolio, with the last saved one shown on load. */
export function PortfolioAiReview({ token }: { token: string | null }) {
  const t = useT();
  const locale = useLocale();
  const [lang] = useLang();
  const [saved, setSaved] = useState<PortfolioAnalysisResponse | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<PortfolioAnalysisResponse | null>("/investing/analysis/portfolio", { token })
      .then((data) => {
        if (alive) setSaved(data);
      })
      .catch(() => {
        if (alive) setSaved(null);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  async function analyze() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setSaved(await apiFetch<PortfolioAnalysisResponse>(`/investing/analysis/portfolio?lang=${lang}`, { method: "POST", token }));
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 0 ? t("Can’t reach the server") : e.message || t("Something went wrong — try again."));
    } finally {
      setBusy(false);
    }
  }

  const a = saved?.analysis;
  const health = a ? HEALTH[a.health] : null;

  return (
    <section className={dashCard} aria-labelledby="ai-review-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <SparkIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 id="ai-review-title" className="text-sm font-semibold text-[#1f1c17]">
              {t("AI portfolio review")}
            </h2>
            <p className="text-xs text-[#8f8676]">
              {t("Holdings, cash, deposits, target weights and your watchlist buy zones, reviewed by Gemini.")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={analyze}
          disabled={busy || saved === undefined || !token}
          className={
            a
              ? "rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] transition hover:bg-[#faf8f2] disabled:opacity-50"
              : "inline-flex items-center gap-2 rounded-full bg-[#1f1c17] px-4 py-2 text-xs font-semibold text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-50"
          }
        >
          {a ? null : <SparkIcon />}
          {busy ? t("Analyzing…") : a ? t("Re-analyze") : t("Analyze portfolio")}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      {busy ? (
        <div className="mt-5 space-y-2.5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-[#6f675b]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden />
            {t("Reviewing {n} areas of your portfolio…", { n: 5 })}
          </p>
          <div className="grid gap-3 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-black/[0.04]" />
            ))}
          </div>
        </div>
      ) : a && health && saved ? (
        <div className="mt-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${health.cls}`}>{t(health.label)}</span>
            <span className="text-[11px] text-[#8f8676]">{t(CONFIDENCE[a.confidence])}</span>
          </div>
          <p className="mt-2 max-w-4xl text-base font-medium leading-snug text-[#1f1c17]">{a.headline}</p>
          <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-[#5f584d]">{a.summary}</p>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {[
              ["Diversification", a.diversification],
              ["Performance & income", a.performance],
              ["Valuation & risk", a.valuation_risk],
            ].map(([name, text]) => (
              <div key={name} className="rounded-xl bg-[#faf8f2] px-4 py-3">
                <p className={label}>{t(name)}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-[#3b352d]">{text}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className={label}>{t("Next steps")}</p>
              <ol className="mt-2 divide-y divide-black/5 rounded-xl border border-black/5">
                {a.actions.map((step, i) => {
                  const move = MOVES[step.action];
                  return (
                    <li key={i} className="flex gap-3 px-3.5 py-2.5">
                      <span className="mt-0.5 w-4 shrink-0 text-xs font-semibold tabular-nums text-[#b5ad9f]">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${move.cls}`}>{t(move.label)}</span>
                          {step.ticker ? <span className="text-xs font-semibold text-[#1f1c17]">{step.ticker}</span> : null}
                        </p>
                        <p className="mt-1 text-xs leading-snug text-[#3b352d]">{step.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            <div className="space-y-4 lg:col-span-2">
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">{t("Cash & next deposits")}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-violet-950">{a.cash_plan}</p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                <div>
                  <p className={label}>{t("Strengths")}</p>
                  <Bullets items={a.strengths} tone="up" />
                </div>
                <div>
                  <p className={label}>{t("Risks")}</p>
                  <Bullets items={a.risks} tone="down" />
                </div>
              </div>
            </div>
          </div>

          <p className="mt-4 text-[11px] leading-snug text-[#8f8676]">
            {[
              modelName(saved.model),
              new Date(saved.created_at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              saved.account_value != null ? t("account value {v}", { v: formatUsd(saved.account_value) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {" — "}
            {t("AI-generated, not financial advice.")}
          </p>
        </div>
      ) : saved === undefined ? null : (
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-[#6f675b]">
          {t("Get a verdict on diversification, drift from your target weights, valuation and risk, plus concrete next steps and where to put your cash.")}
        </p>
      )}
    </section>
  );
}
