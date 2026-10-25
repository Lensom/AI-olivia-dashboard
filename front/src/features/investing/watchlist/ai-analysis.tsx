"use client";

import { useEffect, useState } from "react";
import { formatUsd } from "@/features/investing/format";
import { apiFetch, type ApiError } from "@/lib/api";
import { useLang, useLocale, useT } from "@/lib/i18n";

type Verdict = "strong_buy" | "buy" | "hold" | "wait" | "trim" | "avoid";

type StockAnalysis = {
  verdict: Verdict;
  confidence: "low" | "medium" | "high";
  headline: string;
  summary: string;
  price_vs_zones: string;
  goals_check: string;
  strengths: string[];
  risks: string[];
  action: string;
};

type AnalysisResponse = {
  ticker: string;
  analysis: StockAnalysis;
  model: string;
  lang: string;
  price: number | null;
  created_at: string;
};

const VERDICTS: Record<Verdict, { label: string; cls: string }> = {
  strong_buy: { label: "Strong buy", cls: "bg-emerald-600 text-white" },
  buy: { label: "Buy now", cls: "bg-emerald-100 text-emerald-800" },
  hold: { label: "Keep holding", cls: "bg-sky-100 text-sky-800" },
  wait: { label: "Wait for a better price", cls: "bg-amber-100 text-amber-800" },
  trim: { label: "Consider trimming", cls: "bg-orange-100 text-orange-800" },
  avoid: { label: "Avoid", cls: "bg-rose-100 text-rose-800" },
};

const CONFIDENCE: Record<StockAnalysis["confidence"], string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

/** "gemini-3.1-flash-lite" → "Gemini 3.1 Flash Lite". */
export function modelName(id: string): string {
  return id
    .split("-")
    .map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

export function SparkIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 3c.6 4.9 2.6 7.4 7.5 9-4.9 1.6-6.9 4.1-7.5 9-.6-4.9-2.6-7.4-7.5-9 4.9-1.6 6.9-4.1 7.5-9Z" />
    </svg>
  );
}

export function Bullets({ items, tone }: { items: string[]; tone: "up" | "down" }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {items.map((s) => (
        <li key={s} className="flex gap-2 text-xs leading-snug text-[#3b352d]">
          <span aria-hidden className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${tone === "up" ? "bg-emerald-500" : "bg-rose-500"}`} />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Analyze" button and the last saved Gemini analysis for a watchlist ticker. `own`: your weight, %. */
export function AiAnalysis({ ticker, token, own }: { ticker: string; token: string | null; own: number | undefined }) {
  const t = useT();
  const locale = useLocale();
  const [lang] = useLang();
  // Keyed by ticker so switching rows never shows another stock's analysis.
  const [saved, setSaved] = useState<{ ticker: string; data: AnalysisResponse | null } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<{ ticker: string; message: string } | null>(null);

  useEffect(() => {
    if (!token || !ticker) return;
    let alive = true;
    apiFetch<AnalysisResponse | null>(`/investing/analysis/${encodeURIComponent(ticker)}`, { token })
      .then((data) => {
        if (alive) setSaved({ ticker, data });
      })
      .catch(() => {
        if (alive) setSaved({ ticker, data: null });
      });
    return () => {
      alive = false;
    };
  }, [ticker, token]);

  async function analyze() {
    if (!token) return;
    setRunning(ticker);
    setError(null);
    try {
      const weight = own != null && Number.isFinite(own) ? `&weight=${own.toFixed(2)}` : "";
      const data = await apiFetch<AnalysisResponse>(`/investing/analysis/${encodeURIComponent(ticker)}?lang=${lang}${weight}`, {
        method: "POST",
        token,
      });
      setSaved({ ticker: data.ticker, data });
    } catch (err) {
      const e = err as ApiError;
      setError({ ticker, message: e.status === 0 ? t("Can’t reach the server") : e.message || t("Something went wrong — try again.") });
    } finally {
      setRunning(null);
    }
  }

  const current = saved?.ticker === ticker ? saved.data : null;
  const loadingSaved = saved?.ticker !== ticker;
  const busy = running === ticker;
  const err = error?.ticker === ticker ? error.message : null;
  const a = current?.analysis;
  const verdict = a ? VERDICTS[a.verdict] : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className={`${label} flex items-center gap-1.5`}>
          <SparkIcon className="h-3 w-3 text-violet-500" />
          {t("AI analysis")}
        </p>
        {a && !busy ? (
          <button type="button" onClick={analyze} className="text-[11px] font-medium text-[#2a78d6] hover:underline">
            {t("Re-analyze")}
          </button>
        ) : null}
      </div>

      {busy ? (
        <div className="mt-3 space-y-2" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-[#6f675b]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden />
            {t("Analyzing {ticker} with your plan, position and the latest news…", { ticker })}
          </p>
          {[85, 100, 70].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded bg-black/[0.05]" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : a && verdict && current ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${verdict.cls}`}>{t(verdict.label)}</span>
            <span className="text-[11px] text-[#8f8676]">{t(CONFIDENCE[a.confidence])}</span>
          </div>
          <p className="mt-2 text-sm font-medium leading-snug text-[#1f1c17]">{a.headline}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-[#5f584d]">{a.summary}</p>

          <div className="mt-3 grid gap-2">
            <div className="rounded-xl bg-[#faf8f2] px-3 py-2">
              <p className={label}>{t("Price vs your buy zones")}</p>
              <p className="mt-1 text-xs leading-snug text-[#3b352d]">{a.price_vs_zones}</p>
            </div>
            <div className="rounded-xl bg-[#faf8f2] px-3 py-2">
              <p className={label}>{t("Your price goals")}</p>
              <p className="mt-1 text-xs leading-snug text-[#3b352d]">{a.goals_check}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className={label}>{t("Strengths")}</p>
              <Bullets items={a.strengths} tone="up" />
            </div>
            <div>
              <p className={label}>{t("Risks")}</p>
              <Bullets items={a.risks} tone="down" />
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">{t("Suggested next step")}</p>
            <p className="mt-1 text-xs leading-snug text-violet-950">{a.action}</p>
          </div>

          <p className="mt-2.5 text-[11px] leading-snug text-[#8f8676]">
            {[
              modelName(current.model),
              new Date(current.created_at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              current.price != null ? t("at {price}", { price: formatUsd(current.price) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {" — "}
            {t("AI-generated, not financial advice.")}
          </p>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-xs leading-snug text-[#6f675b]">
            {loadingSaved
              ? t("Loading…")
              : t("Gemini reviews this stock against your buy zones, price goals, notes and position, plus valuation and recent news.")}
          </p>
          <button
            type="button"
            onClick={analyze}
            disabled={loadingSaved || !token}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1f1c17] px-3 py-2 text-xs font-semibold text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-50"
          >
            <SparkIcon />
            {t("Analyze")}
          </button>
        </div>
      )}

      {err ? (
        <p className="mt-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
