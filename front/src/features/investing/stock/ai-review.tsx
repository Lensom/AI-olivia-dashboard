"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { compactMoney, priceText, type StockFit, type StockReview, type StockReviewResponse } from "@/features/investing/stock/data";
import { Bullets, modelName, SparkIcon, STALE_REVIEW, StaleDataNote } from "@/features/investing/watchlist/ai-analysis";
import { signedPct } from "@/features/investing/watchlist/signals";
import { apiFetch, type ApiError } from "@/lib/api";
import { useLang, useLocale, useT, type T } from "@/lib/i18n";

const VERDICTS: Record<StockReview["verdict"], { label: string; cls: string }> = {
  buy: { label: "Buy now", cls: "bg-emerald-600 text-white" },
  buy_partial: { label: "Buy part now", cls: "bg-emerald-100 text-emerald-800" },
  wait_price: { label: "Wait for your price", cls: "bg-amber-100 text-amber-800" },
  no_room: { label: "No room in the portfolio", cls: "bg-sky-100 text-sky-800" },
  avoid: { label: "Don’t buy", cls: "bg-rose-100 text-rose-800" },
};

const CONFIDENCE: Record<StockReview["confidence"], string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

const HEALTH: Record<StockReview["company_health"], { label: string; tone: Tone }> = {
  strong: { label: "In strong shape", tone: "good" },
  solid: { label: "Solid", tone: "good" },
  mixed: { label: "Mixed", tone: "warn" },
  weak: { label: "Weak", tone: "bad" },
};

type Tone = "good" | "warn" | "bad" | "none";

const TONES: Record<Tone, { cls: string; icon: string }> = {
  good: { cls: "bg-emerald-50 text-emerald-800", icon: "✓" },
  warn: { cls: "bg-amber-50 text-amber-800", icon: "◐" },
  bad: { cls: "bg-rose-50 text-rose-800", icon: "✕" },
  none: { cls: "bg-[#f4efe4] text-[#6f675b]", icon: "–" },
};

const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

function Check({ title, tone, value, children }: { title: string; tone: Tone; value: string; children?: React.ReactNode }) {
  const s = TONES[tone];
  return (
    <div className="min-w-0 rounded-xl border border-black/5 bg-[#faf8f2] px-3.5 py-3">
      <p className={label}>{title}</p>
      <p className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${s.cls}`}>
        <span aria-hidden>{s.icon}</span>
        {value}
      </p>
      {children ? <div className="mt-1.5 space-y-0.5 text-xs leading-snug text-[#5f584d]">{children}</div> : null}
    </div>
  );
}

function priceCheck(fit: StockFit, t: T): { tone: Tone; value: string } {
  if (fit.zone === "strong") return { tone: "good", value: t("In your strong-buy zone") };
  if (fit.zone === "may") return { tone: "good", value: t("In your may-buy zone") };
  if (fit.zone === "above") return { tone: "bad", value: t("Above your buy prices") };
  return { tone: "none", value: t("No buy prices set") };
}

function roomCheck(fit: StockFit, t: T): { tone: Tone; value: string } {
  if (fit.room === "room") return { tone: "good", value: t("There is room") };
  if (fit.room === "full") return { tone: "bad", value: t("No room") };
  return { tone: "none", value: t("Not known") };
}

function PriceDetails({ fit }: { fit: StockFit }) {
  const t = useT();
  const next = fit.zone === "strong" ? fit.strong_buy : fit.may_buy ?? fit.strong_buy;
  return (
    <>
      {fit.strong_buy != null ? <p className="tabular-nums">{t("Strong buy until")} {priceText(fit.strong_buy)}</p> : null}
      {fit.may_buy != null ? <p className="tabular-nums">{t("May buy until")} {priceText(fit.may_buy)}</p> : null}
      {fit.price != null && next ? <p className="tabular-nums">{t("Today {price}: {pct} vs your level", { price: priceText(fit.price), pct: signedPct((fit.price / next - 1) * 100) })}</p> : null}
      {fit.zone === "unset" ? (
        <p>
          <Link href="/investing/picking" className="font-medium text-[#2a78d6] hover:underline">
            {fit.on_watchlist ? t("Set them on the Watchlist") : t("Add it to the Watchlist")}
          </Link>
        </p>
      ) : null}
    </>
  );
}

function RoomDetails({ fit }: { fit: StockFit }) {
  const t = useT();
  return (
    <>
      {fit.room_basis === "target" ? (
        <p className="tabular-nums">{t("Weight {w}% of a {target}% target", { w: (fit.weight ?? 0).toFixed(1), target: (fit.target_weight ?? 0).toFixed(1) })}</p>
      ) : null}
      {fit.bucket_positions != null ? (
        <p className="tabular-nums">
          {t("Bucket {w}% of {target}%, {n} of {max} positions", { w: (fit.bucket_weight ?? 0).toFixed(1), target: (fit.bucket_target ?? 0).toFixed(0), n: fit.bucket_positions, max: fit.bucket_max ?? 0 })}
        </p>
      ) : null}
      {fit.full_reason === "bucket_positions" ? <p>{t("The bucket has no free position")}</p> : null}
      {fit.room === "room" && fit.room_usd != null ? <p className="tabular-nums">{t("Room {v}", { v: compactMoney(fit.room_usd) })}</p> : null}
      {fit.cash != null ? <p className="tabular-nums">{t("Cash {v}", { v: priceText(fit.cash) })}</p> : null}
      {fit.max_buy_usd != null ? (
        <p className="font-medium tabular-nums text-[#1f1c17]">
          {t("Up to {v} now", { v: priceText(fit.max_buy_usd) })}
          {fit.max_buy_shares != null ? ` · ${t("{n} shares", { n: fit.max_buy_shares })}` : ""}
        </p>
      ) : null}
      {fit.room === "unknown" ? <p>{t("Set a target weight on the Portfolio page or a bucket on the Watchlist.")}</p> : null}
    </>
  );
}

/** The decision: is the company healthy, is the price yours, is there room; then the AI's call on all three. */
export function AiReview({
  ticker,
  token,
  fit,
  fitLoading,
  companyFacts,
}: {
  ticker: string;
  token: string | null;
  fit: StockFit | null;
  fitLoading: boolean;
  /** A few plain numbers, so the company check says something before the AI has run. */
  companyFacts: string[];
}) {
  const t = useT();
  const locale = useLocale();
  const [lang] = useLang();
  // Keyed by ticker so moving between stocks never shows another stock's review.
  const [saved, setSaved] = useState<{ ticker: string; data: StockReviewResponse | null } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<{ ticker: string; message: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<StockReviewResponse | null>(`/investing/analysis/${encodeURIComponent(ticker)}/review`, { token })
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

  async function run() {
    if (!token) return;
    setRunning(ticker);
    setError(null);
    try {
      const data = await apiFetch<StockReviewResponse>(`/investing/analysis/${encodeURIComponent(ticker)}/review?lang=${lang}`, { method: "POST", token });
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
  const r = current?.review;
  const verdict = r ? VERDICTS[r.verdict] : null;
  const health = r ? HEALTH[r.company_health] : null;
  const price = fit ? priceCheck(fit, t) : null;
  const room = fit ? roomCheck(fit, t) : null;
  // The saved call was made on the checks of that day: flag it when they've flipped since.
  const outdated = !!(current && fit && (current.fit.zone !== fit.zone || current.fit.room !== fit.room));

  return (
    <section className="rounded-2xl border border-violet-200/70 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5" aria-labelledby="stock-decision">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stock-decision" className="flex items-center gap-2 text-sm font-semibold text-[#1f1c17]">
          <SparkIcon className="h-3.5 w-3.5 text-violet-500" />
          {t("Should I buy now?")}
        </h2>
        {r && !busy ? (
          <button type="button" onClick={run} className="text-xs font-medium text-[#2a78d6] hover:underline">
            {t("Re-analyze")}
          </button>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 [&>*]:min-w-0">
        <Check title={t("Company now")} tone={health?.tone ?? "none"} value={health ? t(health.label) : t("AI will judge this")}>
          {companyFacts.map((fact) => (
            <p key={fact} className="tabular-nums">{fact}</p>
          ))}
        </Check>
        {price && fit ? (
          <Check title={t("Your price")} tone={price.tone} value={price.value}>
            <PriceDetails fit={fit} />
          </Check>
        ) : (
          <Check title={t("Your price")} tone="none" value={fitLoading ? t("Loading…") : t("Not known")} />
        )}
        {room && fit ? (
          <Check title={t("Room in the portfolio")} tone={room.tone} value={room.value}>
            <RoomDetails fit={fit} />
          </Check>
        ) : (
          <Check title={t("Room in the portfolio")} tone="none" value={fitLoading ? t("Loading…") : t("Not known")} />
        )}
      </div>

      {fit?.stale_data ? (
        <StaleDataNote className="mt-3" message={t("Freedom24 didn’t answer, so your cash and positions here come from the saved copy and may be out of date.")} />
      ) : null}

      {busy ? (
        <div className="mt-4 space-y-2" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-[#6f675b]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden />
            {t("Reviewing {ticker}: financials, valuation, news, your prices and your portfolio…", { ticker })}
          </p>
          {[85, 100, 70].map((w) => (
            <div key={w} className="h-3 animate-pulse rounded bg-black/[0.05]" style={{ width: `${w}%` }} />
          ))}
        </div>
      ) : r && verdict && current ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${verdict.cls}`}>{t(verdict.label)}</span>
            <span className="text-[11px] text-[#8f8676]">{t(CONFIDENCE[r.confidence])}</span>
          </div>
          <p className="mt-2 text-sm font-medium leading-snug text-[#1f1c17]">{r.headline}</p>

          {current.fit.stale_data && !fit?.stale_data ? <StaleDataNote message={t(STALE_REVIEW)} /> : null}

          {outdated ? (
            <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
              {t("Your price or portfolio check has changed since this review. Re-analyze before acting on it.")}
            </p>
          ) : null}

          <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3.5 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">{t("Suggested next step")}</p>
            <p className="mt-1 text-sm leading-snug text-violet-950">{r.action}</p>
            <p className="mt-1.5 text-xs leading-snug text-violet-900/80">
              {t("What would change this:")} {r.change_mind}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2 [&>*]:min-w-0">
            <div>
              <p className={label}>{t("State of the company")}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#3b352d]">{r.company_state}</p>
            </div>
            <div>
              <p className={label}>{t("Valuation")}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#3b352d]">{r.valuation}</p>
            </div>
            <div>
              <p className={label}>{t("Your price")}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#3b352d]">{r.price_check}</p>
            </div>
            <div>
              <p className={label}>{t("Your portfolio")}</p>
              <p className="mt-1 text-xs leading-relaxed text-[#3b352d]">{r.portfolio_check}</p>
            </div>
            <div>
              <p className={label}>{t("Strengths")}</p>
              <Bullets items={r.strengths} tone="up" />
            </div>
            <div>
              <p className={label}>{t("Risks")}</p>
              <Bullets items={r.risks} tone="down" />
            </div>
          </div>

          <p className="mt-3 text-[11px] leading-snug text-[#8f8676]">
            {[
              modelName(current.model),
              new Date(current.created_at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              current.fit.price != null ? t("at {price}", { price: priceText(current.fit.price) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            {" — "}
            {t("AI-generated, not financial advice.")}
          </p>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-xs leading-snug text-[#6f675b]">
            {loadingSaved ? t("Loading…") : t("Gemini weighs the company’s financials, valuation and news against your buy prices and portfolio, then says whether to buy today.")}
          </p>
          <button
            type="button"
            onClick={run}
            disabled={loadingSaved || !token}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f1c17] px-4 py-2 text-xs font-semibold text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-50 max-sm:w-full"
          >
            <SparkIcon />
            {t("Analyze")}
          </button>
        </div>
      )}

      {err ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          {err}
        </p>
      ) : null}
    </section>
  );
}
