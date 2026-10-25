"use client";

import { useState } from "react";
import { formatUsd } from "@/features/investing/format";
import { AiAnalysis } from "@/features/investing/watchlist/ai-analysis";
import {
  CHART_RANGES,
  consensusLabel,
  formatCap,
  useChart,
  useNews,
  type ChartRange,
  type WatchlistSnapshot,
} from "@/features/investing/watchlist/data";
import { num, RangeBar, signedPct, SignalPill, ZoneBar, type Signal } from "@/features/investing/watchlist/signals";
import { TickerLogo } from "@/features/investing/watchlist/ticker-logo";
import { useLocale, useT } from "@/lib/i18n";
import type { InvestingPickingRow } from "@/state/investing-store";

const section = "border-t border-black/5 px-5 py-4";
const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

/** Closing prices as an area chart, with your strong / may buy levels as dashed lines when they fall in view. */
function TrendChart({ points, strong, may }: { points: [number, number][]; strong: number; may: number }) {
  const t = useT();
  const closes = points.map((p) => p[1]);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = (max - min) * 0.08 || max * 0.02 || 1;
  const lo = min - pad;
  const hi = max + pad;
  const W = 300;
  const H = 110;
  const x = (i: number) => (i / Math.max(1, closes.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H;
  const line = closes.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  const color = up ? "#059669" : "#e11d48";
  const levels = [
    { v: strong, name: t("Strong"), c: "#059669" },
    { v: may, name: t("May"), c: "#d97706" },
  ].filter((l) => Number.isFinite(l.v) && l.v >= lo && l.v <= hi);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-28 w-full overflow-visible" role="img" aria-label={t("Price trend")}>
      <defs>
        <linearGradient id="wl-trend" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#wl-trend)" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {levels.map((l) => (
        <g key={l.name}>
          <line x1="0" x2={W} y1={y(l.v)} y2={y(l.v)} stroke={l.c} strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <title>{`${l.name} ≤ ${formatUsd(l.v)}`}</title>
        </g>
      ))}
    </svg>
  );
}

function Metric({ name, value, tone }: { name: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-xs text-[#6f675b]">{name}</span>
      <span className={`text-xs font-semibold tabular-nums ${tone === "up" ? "text-emerald-700" : tone === "down" ? "text-rose-700" : "text-[#1f1c17]"}`}>{value}</span>
    </div>
  );
}

function timeAgo(iso: string | null, locale: string): string {
  if (!iso) return "";
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, s] of units) if (Math.abs(diff) >= s) return rtf.format(Math.round(diff / s), unit);
  return rtf.format(0, "minute");
}

function News({ ticker, token }: { ticker: string; token: string | null }) {
  const t = useT();
  const locale = useLocale();
  const { items, loading } = useNews(ticker, token);
  if (loading) return <p className="px-1 py-2 text-xs text-[#8f8676]">{t("Loading…")}</p>;
  if (!items.length) return <p className="px-1 py-2 text-xs text-[#8f8676]">{t("No news found.")}</p>;
  return (
    <ul className="mt-2 space-y-2.5">
      {items.map((n) => (
        <li key={n.link}>
          <a href={n.link} target="_blank" rel="noreferrer" className="group block">
            <span className="block text-xs font-medium leading-snug text-[#1f1c17] group-hover:underline">{n.title}</span>
            <span className="text-[11px] text-[#8f8676]">{timeAgo(n.published, locale)}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function DetailsPanel({
  row,
  snapshot,
  signal,
  own,
  token,
  onEdit,
}: {
  row: InvestingPickingRow;
  snapshot: WatchlistSnapshot | undefined;
  signal: Signal;
  own: number | undefined;
  token: string | null;
  onEdit: () => void;
}) {
  const t = useT();
  const ticker = row.ticker.trim().toUpperCase();
  const [range, setRange] = useState<ChartRange>("1M");
  const [newsFor, setNewsFor] = useState<string | null>(null);
  const { points, loading } = useChart(ticker, range, token);

  const px = num(row.current_price);
  const day = num(row.day_change_pct);
  const strong = num(row.strong_buy_until);
  const may = num(row.may_buy_until);
  const s = snapshot;
  const change = points.length > 1 ? (points[points.length - 1][1] / points[0][1] - 1) * 100 : NaN;
  const fromHigh = s?.high_52w ? (px / s.high_52w - 1) * 100 : NaN;
  const toTarget = s?.target_price ? (s.target_price / px - 1) * 100 : NaN;
  const name = (row.name.trim().toUpperCase() !== ticker && row.name.trim()) || s?.name || ticker;
  const fmt = (v: number | null | undefined, suffix = "") => (v != null && Number.isFinite(v) ? `${v.toFixed(2)}${suffix}` : "—");

  return (
    <aside className="overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
      <div className="flex items-start gap-3 px-5 py-4">
        <TickerLogo ticker={ticker} size={40} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-[#1f1c17]" title={name}>{name}</h2>
          <p className="truncate text-[11px] text-[#8f8676]">{[ticker, s?.exchange, s?.sector || row.industry].filter(Boolean).join(" · ")}</p>
        </div>
        <a
          href={`https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11px] font-medium text-[#2a78d6] hover:underline"
        >
          Finviz ↗
        </a>
      </div>

      <div className={section}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label={t("Trend")}>
            {CHART_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={r === range}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r === range ? "bg-[#1f1c17] text-white" : "text-[#6f675b] hover:bg-[#faf8f2]"}`}
              >
                {r}
              </button>
            ))}
          </div>
          <span className={`text-xs font-semibold tabular-nums ${change >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{signedPct(change)}</span>
        </div>
        <div className="mt-3">
          {points.length > 1 ? (
            <TrendChart points={points} strong={strong} may={may} />
          ) : (
            <p className="flex h-28 items-center justify-center text-xs text-[#8f8676]">{loading ? t("Loading…") : t("No price history.")}</p>
          )}
        </div>
      </div>

      <div className={section}>
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-semibold tabular-nums text-[#1f1c17]">{Number.isFinite(px) ? formatUsd(px) : "—"}</span>
          <span className={`text-xs font-semibold tabular-nums ${day > 0 ? "text-emerald-700" : day < 0 ? "text-rose-700" : "text-[#8f8676]"}`}>
            {Number.isFinite(day) ? `${signedPct(day, 2)} ${t("today")}` : ""}
          </span>
        </p>
        <div className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Metric name={s?.is_fund ? t("Assets (AUM)") : t("Market cap")} value={s?.market_cap ? formatCap(s.market_cap) : "—"} />
          <Metric name={t("From 52-week high")} value={signedPct(fromHigh)} tone={fromHigh < -10 ? "down" : undefined} />
          {s?.is_fund ? (
            <>
              <Metric name={t("Expense ratio")} value={fmt(s.expense, "%")} />
              <Metric name={t("Dividend yield")} value={fmt(s.div_yield, "%")} />
            </>
          ) : (
            <>
              <Metric name="P/E" value={fmt(s?.pe)} />
              <Metric name={t("Forward P/E")} value={fmt(s?.forward_pe)} />
              <Metric name="EV/EBITDA" value={fmt(s?.ev_ebitda)} />
              <Metric name={t("Revenue growth")} value={s?.sales_growth != null ? signedPct(s.sales_growth) : "—"} tone={s?.sales_growth != null ? (s.sales_growth >= 0 ? "up" : "down") : undefined} />
              <Metric name={t("Analyst consensus")} value={s?.recom != null ? t(consensusLabel(s.recom), { v: s.recom.toFixed(1) }) : "—"} />
              <Metric
                name={t("Analyst target")}
                value={s?.target_price != null ? `${formatUsd(s.target_price)} (${signedPct(toTarget, 0)})` : "—"}
                tone={Number.isFinite(toTarget) ? (toTarget >= 0 ? "up" : "down") : undefined}
              />
            </>
          )}
        </div>
      </div>

      <div className={section}>
        <p className={label}>{t("52-week range")}</p>
        <RangeBar low={s?.low_52w} high={s?.high_52w} price={px} strong={strong} may={may} className="mt-3 w-full" tall />
        <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-[#8f8676]">
          <span>{s?.low_52w != null ? formatUsd(s.low_52w) : "—"}</span>
          <span>{s?.high_52w != null ? formatUsd(s.high_52w) : "—"}</span>
        </div>
      </div>

      <div className={section}>
        <div className="flex items-center justify-between gap-2">
          <p className={label}>{t("Your buy zones")}</p>
          <button type="button" onClick={onEdit} className="text-[11px] font-medium text-[#2a78d6] hover:underline">
            {t("Edit")}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SignalPill signal={signal} />
          <span className="text-[11px] text-[#8f8676]">{signal.detail}</span>
        </div>
        <ZoneBar row={row} className="mt-3 w-full" />
        <div className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <Metric name={t("Strong buy until")} value={Number.isFinite(strong) ? formatUsd(strong) : "—"} />
          <Metric name={t("May buy until")} value={Number.isFinite(may) ? formatUsd(may) : "—"} />
          <Metric name={t("Upside 1y / 5y")} value={`${signedPct((num(row.price_goal_1y) / px - 1) * 100, 0)} / ${signedPct((num(row.price_goal_5y) / px - 1) * 100, 0)}`} />
          <Metric name={t("You own")} value={own != null ? `${own.toFixed(1)}%` : "—"} />
        </div>
        {row.notes.trim() ? <p className="mt-2 whitespace-pre-line text-xs text-[#6f675b]">{row.notes}</p> : null}
      </div>

      <div className={section}>
        <AiAnalysis ticker={ticker} token={token} own={own} />
      </div>

      <div className={section}>
        <button
          type="button"
          onClick={() => setNewsFor(newsFor === ticker ? null : ticker)}
          aria-expanded={newsFor === ticker}
          className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
        >
          {t("Company news")} {newsFor === ticker ? "▴" : "▾"}
        </button>
        {newsFor === ticker ? <News ticker={ticker} token={token} /> : null}
      </div>
    </aside>
  );
}
