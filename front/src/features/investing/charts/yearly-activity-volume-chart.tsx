"use client";

import { useT } from "@/lib/i18n";
import { useMemo } from "react";

export type YearlyActivityPoint = {
  year: number;
  purchases: number;
  sales: number;
};

function niceYMax(max: number): number {
  if (max <= 0) return 1000;
  const step = 10 ** Math.floor(Math.log10(max));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * step);
  return candidates.find((c) => c >= max) ?? 10 * step;
}

function formatYTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

const PAD_L = 52;
const PAD_R = 16;
const PAD_T = 36;
const PAD_B = 48;
const INNER_W = 520;
const INNER_H = 200;

export function YearlyActivityVolumeChart({
  title = "Buy vs sell volume by year",
  subtitle = "Gross amounts from activity log (USD).",
  data,
}: {
  title?: string;
  subtitle?: string;
  data: YearlyActivityPoint[];
}) {
  const tr = useT();
  const { groups, yMax, ticks, viewW, viewH } = useMemo(() => {
    const viewW = INNER_W + PAD_L + PAD_R;
    const viewH = INNER_H + PAD_T + PAD_B;
    const n = data.length;
    if (n === 0) {
      return { groups: [], yMax: 0, ticks: [], viewW, viewH };
    }
    const maxVal = Math.max(...data.flatMap((d) => [d.purchases, d.sales]));
    const yMax = niceYMax(maxVal);
    const tickCount = 5;
    const ticks = Array.from({ length: tickCount }, (_, i) => (yMax * i) / (tickCount - 1));

    const clusterGap = 16;
    const pairGap = 4;
    const clusterW = Math.max(28, (INNER_W - clusterGap * (n + 1)) / n);
    const barW = (clusterW - pairGap) / 2;

    const groups = data.map((d, i) => {
      const cx = PAD_L + clusterGap + i * (clusterW + clusterGap);
      const hBuy = d.purchases > 0 ? (d.purchases / yMax) * INNER_H : 0;
      const hSell = d.sales > 0 ? (d.sales / yMax) * INNER_H : 0;
      const yBuy = PAD_T + INNER_H - hBuy;
      const ySell = PAD_T + INNER_H - hSell;
      return {
        year: d.year,
        buy: { x: cx, y: yBuy, w: barW, h: hBuy },
        sell: { x: cx + barW + pairGap, y: ySell, w: barW, h: hSell },
      };
    });

    return { groups, yMax, ticks, viewW, viewH };
  }, [data]);

  const hasAny = data.some((d) => d.purchases > 0 || d.sales > 0);

  if (data.length === 0 || !hasAny) {
    return (
      <article className="flex h-full min-h-[300px] flex-col rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr(title)}</h2>
          <span className="rounded-xl border border-black/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#6f675b]">
            Activities
          </span>
        </div>
        <p className="mt-1 text-xs text-[#655d51]">{tr(subtitle)}</p>
        <p className="mt-10 text-center text-sm text-[#7f7668]">{tr("No buy/sell amounts by year yet.")}</p>
      </article>
    );
  }

  return (
    <article className="flex h-full flex-col rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#1f1c17]">{tr(title)}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-[#655d51]">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-500" aria-hidden />
            {tr("Purchases")}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-[#655d51]">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" aria-hidden />
            {tr("Sales")}
          </span>
          <span className="rounded-xl border border-black/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#6f675b]">
            Activities
          </span>
        </div>
      </div>
      <p className="mt-1 text-xs text-[#655d51]">{tr(subtitle)}</p>
      <svg
        className="mx-auto mt-2 w-full max-w-full"
        viewBox={`0 0 ${viewW} ${viewH}`}
        role="img"
        aria-label={tr(title)}
      >
        <rect x="0" y="0" width={viewW} height={viewH} fill="#ffffff" />
        {ticks.map((tv) => {
          const gy = PAD_T + INNER_H - (tv / yMax) * INNER_H;
          return (
            <g key={tv}>
              <line
                x1={PAD_L}
                x2={PAD_L + INNER_W}
                y1={gy}
                y2={gy}
                stroke="rgba(0,0,0,0.08)"
                strokeWidth={1}
              />
              <text x={PAD_L - 8} y={gy + 4} textAnchor="end" fill="#7f7668" fontSize={10}>
                {formatYTick(tv)}
              </text>
            </g>
          );
        })}
        <text
          x={12}
          y={PAD_T + INNER_H / 2}
          transform={`rotate(-90 12 ${PAD_T + INNER_H / 2})`}
          textAnchor="middle"
          fill="#655d51"
          fontSize={11}
        >
          USD
        </text>
        {groups.map((g) => (
          <g key={g.year}>
            <rect
              x={g.buy.x}
              y={g.buy.y}
              width={g.buy.w}
              height={Math.max(g.buy.h, 0)}
              rx={3}
              fill="#34d399"
              stroke="#047857"
              strokeWidth={1}
            />
            <rect
              x={g.sell.x}
              y={g.sell.y}
              width={g.sell.w}
              height={Math.max(g.sell.h, 0)}
              rx={3}
              fill="#fbbf24"
              stroke="#b45309"
              strokeWidth={1}
            />
            <text
              x={g.buy.x + (g.buy.w + 4 + g.sell.w) / 2}
              y={PAD_T + INNER_H + 18}
              textAnchor="middle"
              fill="#3b352d"
              fontSize={11}
            >
              {g.year}
            </text>
          </g>
        ))}
        <text
          x={PAD_L + INNER_W / 2}
          y={viewH - 10}
          textAnchor="middle"
          fill="#655d51"
          fontSize={11}
        >
          Year
        </text>
      </svg>
    </article>
  );
}
