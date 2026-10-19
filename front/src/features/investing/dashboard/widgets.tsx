"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatUsd } from "@/features/investing/format";
import { useT } from "@/lib/i18n";
import { squarify, type Position } from "./derive";

export const dashCard =
  "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

/** Validated categorical order (dataviz reference palette, light). Slots past 7 fold into "Other". */
export const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
export const OTHER_COLOR = "#a8a29a";

export function signedUsd(n: number): string {
  return `${n > 0 ? "+" : ""}${formatUsd(n)}`;
}

export function signedPct(n: number, digits = 2): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function toneClass(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-[#6f675b]";
}

/** Card title and hint; both are interface keys, translated here. */
export function CardHeader({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-[#1f1c17]">{t(title)}</h2>
        {hint ? <p className="mt-0.5 text-xs text-[#8f8676]">{t(hint)}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function KpiTile({
  label,
  value,
  valueTone,
  sub,
  hero = false,
}: {
  label: string;
  value: string;
  valueTone?: string;
  sub?: ReactNode;
  hero?: boolean;
}) {
  const t = useT();
  return (
    <article className={dashCard}>
      <p className="text-xs font-medium text-[#7f7668]">{t(label)}</p>
      <p
        className={[
          "mt-1.5 font-semibold tabular-nums",
          hero ? "text-3xl" : "text-xl",
          valueTone ?? "text-[#1f1c17]",
        ].join(" ")}
      >
        {value}
      </p>
      {sub ? <div className="mt-1 text-xs text-[#6f675b]">{sub}</div> : null}
    </article>
  );
}

// ---- Heatmap -------------------------------------------------------------------------------

const GAIN_STEPS = ["#dcefe3", "#a8dcbc", "#4fb57f", "#1f8a54", "#0f6b3d"];
const LOSS_STEPS = ["#f8dfe0", "#f0b3b6", "#e0737a", "#c2414b", "#9e2a33"];
const NEUTRAL = "#ece8df";

function dayFill(d: number | null): { bg: string; fg: string } {
  if (d == null || Math.abs(d) < 0.1) return { bg: NEUTRAL, fg: "#3b352d" };
  const a = Math.abs(d);
  const idx = a < 0.5 ? 0 : a < 1 ? 1 : a < 2 ? 2 : a < 3 ? 3 : 4;
  return { bg: (d > 0 ? GAIN_STEPS : LOSS_STEPS)[idx]!, fg: idx >= 2 ? "#ffffff" : "#1f1c17" };
}

/** Finviz-style map: tile area = portfolio weight, color = today's move. */
export function HoldingsHeatmap({ positions }: { positions: Position[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Position | null>(null);
  const t = useT();

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rects = useMemo(
    () => squarify(positions.map((p) => p.value), size.w, size.h),
    [positions, size.w, size.h],
  );

  return (
    <div>
      <div ref={boxRef} className="relative h-[300px] w-full overflow-hidden rounded-xl bg-white">
        {positions.map((p, i) => {
          const r = rects[i];
          if (!r || r.w <= 0 || r.h <= 0) return null;
          const { bg, fg } = dayFill(p.dayPct);
          const showText = r.w > 44 && r.h > 30;
          return (
            <div
              key={p.id}
              onMouseEnter={() => setHover(p)}
              onMouseLeave={() => setHover(null)}
              className="absolute flex flex-col items-center justify-center overflow-hidden rounded-md text-center transition-[filter] hover:brightness-95"
              style={{
                left: r.x + 1,
                top: r.y + 1,
                width: Math.max(0, r.w - 2),
                height: Math.max(0, r.h - 2),
                background: bg,
                color: fg,
              }}
            >
              {showText ? (
                <>
                  <span className={r.w > 90 && r.h > 60 ? "text-base font-semibold" : "text-xs font-semibold"}>
                    {p.ticker}
                  </span>
                  <span className="text-[11px] font-medium tabular-nums opacity-90">
                    {p.dayPct == null ? "—" : signedPct(p.dayPct)}
                  </span>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex min-h-[20px] flex-wrap items-center justify-between gap-2 text-xs text-[#6f675b]">
        {hover ? (
          <span className="tabular-nums">
            <span className="font-semibold text-[#1f1c17]">{hover.ticker}</span> · {t("{v}% of portfolio", { v: hover.weight.toFixed(1) })} ·{" "}
            {formatUsd(hover.value)} · {t("today")}{" "}
            <span className={toneClass(hover.dayPct ?? 0)}>
              {hover.dayPct == null ? "—" : `${signedPct(hover.dayPct)} (${signedUsd(hover.dayUsd ?? 0)})`}
            </span>{" "}
            · {t("total")} <span className={toneClass(hover.pnl)}>{signedPct(hover.pnlPct, 1)}</span>
          </span>
        ) : (
          <span>{t("Size = weight · color = today’s move. Hover a tile for details.")}</span>
        )}
        <span className="flex items-center gap-1" aria-label={t("Color scale from -3% to +3%")}>
          <span>−3%</span>
          {[...LOSS_STEPS].reverse().map((c) => (
            <span key={c} className="h-2.5 w-4 rounded-sm" style={{ background: c }} />
          ))}
          <span className="h-2.5 w-4 rounded-sm" style={{ background: NEUTRAL }} />
          {GAIN_STEPS.map((c) => (
            <span key={c} className="h-2.5 w-4 rounded-sm" style={{ background: c }} />
          ))}
          <span>+3%</span>
        </span>
      </div>
    </div>
  );
}

// ---- Movers ---------------------------------------------------------------------------------

function MoverRow({ p }: { p: Position }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="min-w-0">
        <span className="font-semibold text-[#1f1c17]">{p.ticker}</span>{" "}
        <span className="truncate text-xs text-[#8f8676]">{formatUsd(p.price)}</span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span className={`font-semibold ${toneClass(p.dayPct ?? 0)}`}>{signedPct(p.dayPct ?? 0)}</span>
        <span className="ml-2 text-xs text-[#6f675b]">{signedUsd(p.dayUsd ?? 0)}</span>
      </span>
    </li>
  );
}

export function TodayMovers({ positions }: { positions: Position[] }) {
  const quoted = positions.filter((p) => p.dayPct != null);
  const sorted = [...quoted].sort((a, b) => (b.dayPct ?? 0) - (a.dayPct ?? 0));
  const gainers = sorted.filter((p) => (p.dayPct ?? 0) > 0).slice(0, 3);
  const losers = sorted.filter((p) => (p.dayPct ?? 0) < 0).reverse().slice(0, 3);
  const biggestImpact = [...quoted].sort((a, b) => Math.abs(b.dayUsd ?? 0) - Math.abs(a.dayUsd ?? 0))[0];
  const t = useT();

  if (quoted.length === 0) {
    return <p className="mt-4 text-sm text-[#8f8676]">{t("No live quotes yet — use Refresh market on Portfolio.")}</p>;
  }
  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8f8676]">▲ {t("Top gainers")}</p>
        {gainers.length ? (
          <ul className="divide-y divide-black/5">{gainers.map((p) => <MoverRow key={p.id} p={p} />)}</ul>
        ) : (
          <p className="py-1.5 text-sm text-[#8f8676]">{t("Nothing up today.")}</p>
        )}
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#8f8676]">▼ {t("Top losers")}</p>
        {losers.length ? (
          <ul className="divide-y divide-black/5">{losers.map((p) => <MoverRow key={p.id} p={p} />)}</ul>
        ) : (
          <p className="py-1.5 text-sm text-[#8f8676]">{t("Nothing down today.")}</p>
        )}
      </div>
      {biggestImpact ? (
        <p className="rounded-lg bg-[#faf8f2] px-3 py-2 text-xs text-[#6f675b]">
          {t("Biggest $ impact:")} <span className="font-semibold text-[#1f1c17]">{biggestImpact.ticker}</span>{" "}
          <span className={toneClass(biggestImpact.dayUsd ?? 0)}>{signedUsd(biggestImpact.dayUsd ?? 0)}</span>
        </p>
      ) : null}
    </div>
  );
}

// ---- Performance (diverging bars) ------------------------------------------------------------

export function PerformanceBars({ positions }: { positions: Position[] }) {
  const rows = [...positions].sort((a, b) => b.pnlPct - a.pnlPct);
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.pnlPct)));
  const [hover, setHover] = useState<string | null>(null);

  return (
    <ul className="mt-3 space-y-1">
      {rows.map((p) => {
        const widthPct = (Math.abs(p.pnlPct) / maxAbs) * 50;
        const positive = p.pnlPct >= 0;
        return (
          <li
            key={p.id}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            className={[
              "grid grid-cols-[56px_1fr_132px] items-center gap-2 rounded-md px-1 py-1 text-sm",
              hover === p.id ? "bg-[#faf8f2]" : "",
            ].join(" ")}
          >
            <span className="font-semibold text-[#1f1c17]">{p.ticker}</span>
            <span className="relative h-3">
              <span className="absolute inset-y-[-3px] left-1/2 w-px bg-black/25" />
              <span
                className={[
                  "absolute inset-y-0",
                  positive ? "left-1/2 rounded-r bg-emerald-500" : "right-1/2 rounded-l bg-rose-500",
                ].join(" ")}
                style={{ width: `${Math.max(widthPct, 0.5)}%` }}
              />
            </span>
            <span className="text-right text-xs tabular-nums">
              <span className={`font-semibold ${toneClass(p.pnlPct)}`}>{signedPct(p.pnlPct, 1)}</span>
              <span className="ml-1.5 text-[#6f675b]">{signedUsd(p.pnl)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Sector exposure -------------------------------------------------------------------------

export function SectorBars({ positions }: { positions: Position[] }) {
  const rows = useMemo(() => {
    const by = new Map<string, { value: number; tickers: string[] }>();
    const total = positions.reduce((a, p) => a + p.value, 0) || 1;
    for (const p of positions) {
      const cur = by.get(p.industry) ?? { value: 0, tickers: [] };
      cur.value += p.value;
      cur.tickers.push(p.ticker);
      by.set(p.industry, cur);
    }
    return [...by.entries()]
      .map(([label, v]) => ({ label, pct: (v.value / total) * 100, value: v.value, tickers: v.tickers }))
      .sort((a, b) => b.pct - a.pct);
  }, [positions]);
  const max = Math.max(1, ...rows.map((r) => r.pct));
  const unclassified = rows.find((r) => r.label === "Unclassified");
  const t = useT();

  return (
    <div className="mt-3 space-y-2.5">
      {rows.map((r) => (
        <div key={r.label} title={r.tickers.join(", ")}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-[#2f2922]">{r.label === "Unclassified" ? t("Unclassified") : r.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-[#6f675b]">
              <span className="font-semibold text-[#1f1c17]">{r.pct.toFixed(1)}%</span> · {formatUsd(r.value)}
            </span>
          </div>
          <div className="mt-1 h-2 w-full rounded-full bg-black/5">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${(r.pct / max) * 100}%`,
                background: r.label === "Unclassified" ? OTHER_COLOR : CATEGORICAL[0],
              }}
            />
          </div>
        </div>
      ))}
      {unclassified ? (
        <p className="pt-1 text-xs text-[#8f8676]">
          {t("Unclassified: {tickers} — set Industry on Portfolio (expand row in Edit).", { tickers: unclassified.tickers.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}

// ---- Concentration ---------------------------------------------------------------------------

export function ConcentrationCard({ positions }: { positions: Position[] }) {
  const weights = [...positions].map((p) => p.weight).sort((a, b) => b - a);
  const topN = (n: number) => weights.slice(0, n).reduce((a, w) => a + w, 0);
  const hhi = weights.reduce((a, w) => a + (w / 100) ** 2, 0);
  const effective = hhi > 0 ? 1 / hhi : 0;
  const largest = [...positions].sort((a, b) => b.weight - a.weight)[0];
  const top1 = topN(1);
  const t = useT();

  const level =
    top1 > 25 || topN(3) > 60
      ? { icon: "⚠", label: "High concentration", cls: "border-amber-300 bg-amber-50 text-amber-900" }
      : top1 > 15 || topN(3) > 45
        ? { icon: "◐", label: "Moderate concentration", cls: "border-black/10 bg-[#faf8f2] text-[#3b352d]" }
        : { icon: "✓", label: "Well diversified", cls: "border-emerald-200 bg-emerald-50 text-emerald-900" };

  const stat = (label: string, value: string, hint?: string) => (
    <div className="rounded-xl bg-[#faf8f2] px-3 py-2.5">
      <p className="text-[11px] text-[#8f8676]">{t(label)}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-[#1f1c17]">{value}</p>
      {hint ? <p className="text-[11px] text-[#8f8676]">{hint}</p> : null}
    </div>
  );

  return (
    <div className="mt-3 space-y-3">
      <p className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${level.cls}`}>
        <span aria-hidden>{level.icon}</span> {t(level.label)}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {stat("Largest position", `${top1.toFixed(1)}%`, largest?.ticker)}
        {stat("Top 3 / Top 5", `${topN(3).toFixed(0)}% / ${topN(5).toFixed(0)}%`)}
        {stat("Effective holdings", effective.toFixed(1), t("of {n} positions", { n: positions.length }))}
        {stat(
          "In profit / loss",
          `${positions.filter((p) => p.pnl > 0).length} / ${positions.filter((p) => p.pnl < 0).length}`,
        )}
      </div>
      <p className="text-[11px] leading-relaxed text-[#8f8676]">
        {t("Effective holdings = 1 / Σ weight² — how many equal-sized positions your portfolio behaves like.")}
      </p>
    </div>
  );
}

// ---- Rebalance -------------------------------------------------------------------------------

export function RebalanceTable({ positions, totalValue }: { positions: Position[]; totalValue: number }) {
  const targetSum = positions.reduce((a, p) => a + p.target, 0);
  const t = useT();
  if (targetSum <= 0) {
    return <p className="mt-4 text-sm text-[#8f8676]">{t("Set Target % on the Portfolio tab to get buy / trim suggestions.")}</p>;
  }
  const rows = positions
    .map((p) => {
      const drift = p.weight - p.target;
      const delta = (totalValue * p.target) / 100 - p.value;
      return { p, drift, delta, sharesDelta: p.price > 0 ? delta / p.price : 0 };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return (
    <div className="mt-3">
      {Math.abs(targetSum - 100) > 0.5 ? (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          ⚠ {t("Targets sum to {v}%, not 100% — suggestions are approximate.", { v: targetSum.toFixed(1) })}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <thead className="text-[11px] text-[#8f8676]">
            <tr>
              <th className="py-1.5 font-medium">{t("Ticker")}</th>
              <th className="py-1.5 text-right font-medium">{t("Current")}</th>
              <th className="py-1.5 text-right font-medium">{t("Target")}</th>
              <th className="py-1.5 text-right font-medium">{t("Drift")}</th>
              <th className="py-1.5 text-right font-medium">{t("Action")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, drift, delta, sharesDelta }) => {
              const hold = Math.abs(drift) < 1;
              return (
                <tr key={p.id} className="border-t border-black/5">
                  <td className="py-1.5 font-semibold text-[#1f1c17]">{p.ticker}</td>
                  <td className="py-1.5 text-right text-[#2f2922]">{p.weight.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-[#2f2922]">{p.target.toFixed(1)}%</td>
                  <td className={`py-1.5 text-right ${hold ? "text-[#8f8676]" : toneClass(-drift)}`}>
                    {drift > 0 ? "+" : ""}
                    {drift.toFixed(1)} {t("pp")}
                  </td>
                  <td className="py-1.5 text-right text-xs">
                    {hold ? (
                      <span className="text-[#8f8676]">{t("Hold position")}</span>
                    ) : delta > 0 ? (
                      <span className="font-medium text-emerald-700">
                        {t("Buy {v}", { v: formatUsd(delta) })} <span className="text-[#8f8676]">≈{sharesDelta.toFixed(1)} {t("sh")}</span>
                      </span>
                    ) : (
                      <span className="font-medium text-rose-700">
                        {t("Trim {v}", { v: formatUsd(-delta) })} <span className="text-[#8f8676]">≈{(-sharesDelta).toFixed(1)} {t("sh")}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-[#8f8676]">{t("Drift within ±1 pp is treated as on target.")}</p>
    </div>
  );
}
