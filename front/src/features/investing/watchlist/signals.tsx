"use client";

import { formatUsd, parseUsd } from "@/features/investing/format";
import { useT, type T } from "@/lib/i18n";
import type { InvestingPickingRow } from "@/state/investing-store";

export function num(s: string | undefined): number {
  const raw = String(s ?? "").trim();
  if (!raw) return NaN;
  const n = parseUsd(raw);
  return Number.isFinite(n) && /\d/.test(raw) ? n : NaN;
}

export function signedPct(n: number, digits = 1): string {
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}%` : "—";
}

export type Signal = { rank: number; label: string; detail: string; cls: string; icon: string };

/** Where the price sits against the user's buy zones; rank sorts the best opportunities first. */
export function buySignal(row: InvestingPickingRow, t: T): Signal {
  const override = row.buy_right_now.trim();
  if (override) return { rank: 2, label: override, detail: t("Manual note"), cls: "bg-[#f4efe4] text-[#3b352d]", icon: "✎" };
  const px = num(row.current_price);
  const strong = num(row.strong_buy_until);
  const may = num(row.may_buy_until);
  if (!Number.isFinite(px)) return { rank: 5, label: t("No price"), detail: t("Refresh quotes"), cls: "bg-[#f4efe4] text-[#8f8676]", icon: "…" };
  if (Number.isFinite(strong) && px <= strong)
    return { rank: 0, label: t("Strong buy"), detail: `${signedPct((px / strong - 1) * 100)} ${t("vs")} ${formatUsd(strong)}`, cls: "bg-emerald-50 text-emerald-800", icon: "▼" };
  if (Number.isFinite(may) && px <= may)
    return { rank: 1, label: t("May buy"), detail: `${signedPct((px / may - 1) * 100)} ${t("vs")} ${formatUsd(may)}`, cls: "bg-amber-50 text-amber-800", icon: "◐" };
  const next = Number.isFinite(may) ? may : strong;
  if (!Number.isFinite(next)) return { rank: 4, label: t("No zone set"), detail: t("Add buy prices in Edit"), cls: "bg-[#f4efe4] text-[#8f8676]", icon: "–" };
  return { rank: 3, label: t("Wait"), detail: t("needs {pct} to {v}", { pct: signedPct((next / px - 1) * 100), v: formatUsd(next) }), cls: "bg-rose-50 text-rose-800", icon: "■" };
}

export function SignalPill({ signal }: { signal: Signal }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${signal.cls}`}>
      <span aria-hidden>{signal.icon}</span>
      {signal.label}
    </span>
  );
}

/** Price track: green = strong-buy zone, amber = may-buy zone, dot = current price. */
export function ZoneBar({ row, className = "w-36" }: { row: InvestingPickingRow; className?: string }) {
  const t = useT();
  const px = num(row.current_price);
  const strong = num(row.strong_buy_until);
  const may = num(row.may_buy_until);
  const levels = [px, strong, may].filter(Number.isFinite);
  if (!Number.isFinite(px) || levels.length < 2) return <span className="text-xs text-[#b0a79a]">—</span>;
  const lo = Math.min(...levels) * 0.85;
  const hi = Math.max(...levels) * 1.08;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div
      className={`relative h-2.5 rounded-full bg-black/5 ${className}`}
      title={`${t("Strong")} ≤ ${Number.isFinite(strong) ? formatUsd(strong) : "—"} · ${t("May")} ≤ ${Number.isFinite(may) ? formatUsd(may) : "—"} · ${t("Now")} ${formatUsd(px)}`}
    >
      {Number.isFinite(strong) ? <div className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-400/80" style={{ width: x(strong) }} /> : null}
      {Number.isFinite(may) ? (
        <div
          className="absolute inset-y-0 bg-amber-300/80"
          style={{ left: Number.isFinite(strong) ? x(strong) : "0%", width: `calc(${x(may)} - ${Number.isFinite(strong) ? x(strong) : "0%"})` }}
        />
      ) : null}
      <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#1f1c17]" style={{ left: x(px) }} />
    </div>
  );
}

/**
 * 52-week low → high with today's price as a dot. Your strong / may buy zones are shaded on the
 * same track, so you can see how far the price is from them in this year's range.
 */
export function RangeBar({
  low,
  high,
  price,
  strong,
  may,
  className = "w-20",
  tall,
}: {
  low: number | null | undefined;
  high: number | null | undefined;
  price: number;
  strong?: number;
  may?: number;
  className?: string;
  tall?: boolean;
}) {
  const t = useT();
  if (low == null || high == null || !(high > low) || !Number.isFinite(price)) return <span className="text-xs text-[#b0a79a]">—</span>;
  const pos = (v: number) => Math.max(0, Math.min(100, ((v - low) / (high - low)) * 100));
  const s = strong != null && Number.isFinite(strong) ? pos(strong) : 0;
  const m = may != null && Number.isFinite(may) ? pos(may) : s;
  return (
    <div
      className={`relative rounded-full bg-black/10 ${tall ? "h-2" : "h-1.5"} ${className}`}
      title={`${t("52-week range")}: ${formatUsd(low)} – ${formatUsd(high)} · ${t("Now")} ${formatUsd(price)}`}
    >
      {s > 0 ? <div className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-400/70" style={{ width: `${s}%` }} /> : null}
      {m > s ? <div className="absolute inset-y-0 bg-amber-300/80" style={{ left: `${s}%`, width: `${m - s}%` }} /> : null}
      <div
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#2a78d6] shadow ${tall ? "h-3.5 w-3.5" : "h-2.5 w-2.5"}`}
        style={{ left: `${pos(price)}%` }}
      />
    </div>
  );
}
