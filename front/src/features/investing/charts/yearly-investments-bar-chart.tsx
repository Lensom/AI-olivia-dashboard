"use client";

import { useT } from "@/lib/i18n";
import { useMemo } from "react";

export type YearlyInvestPoint = {
  year: number;
  value: number;
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
const PAD_T = 28;
const PAD_B = 48;
const INNER_W = 520;
const INNER_H = 220;

export function YearlyInvestmentsBarChart({
  title = "Amount of investments by year",
  data,
  yAxisLabel = "Sum of invest",
  xAxisLabel = "Year",
}: {
  title?: string;
  data: YearlyInvestPoint[];
  yAxisLabel?: string;
  xAxisLabel?: string;
}) {
  const tr = useT();
  const { bars, yMax, ticks, viewW, viewH } = useMemo(() => {
    const viewW = INNER_W + PAD_L + PAD_R;
    const viewH = INNER_H + PAD_T + PAD_B;

    const maxVal = data.length ? Math.max(...data.map((d) => d.value)) : 0;
    const yMax = niceYMax(maxVal);
    const tickCount = 5;
    const ticks = Array.from({ length: tickCount }, (_, i) => (yMax * i) / (tickCount - 1));

    const barGap = 12;
    const n = Math.max(1, data.length);
    const barW = Math.max(16, (INNER_W - barGap * (n + 1)) / n);

    const bars = data.map((d, i) => {
      const x = PAD_L + barGap + i * (barW + barGap);
      const h = d.value > 0 ? (d.value / yMax) * INNER_H : 0;
      const y = PAD_T + INNER_H - h;
      return { ...d, x, y, w: barW, h };
    });

    return { bars, yMax, ticks, viewW, viewH };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col rounded-2xl border border-black/5 bg-white p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <h2 className="text-center text-sm font-semibold text-[#1f1c17]">{tr(title)}</h2>
        <p className="mt-8 text-center text-sm text-[#7f7668]">{tr("No buy activities with dates yet.")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-black/5 bg-white p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
      <h2 className="text-center text-sm font-semibold text-[#1f1c17]">{tr(title)}</h2>
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
              <text
                x={PAD_L - 8}
                y={gy + 4}
                textAnchor="end"
                fill="#7f7668"
                fontSize={10}
              >
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
          {tr(yAxisLabel)}
        </text>
        {bars.map((b) => (
          <g key={b.year}>
            <rect
              x={b.x}
              y={b.y}
              width={b.w}
              height={Math.max(b.h, 0)}
              rx={4}
              fill="#c8e6d0"
              stroke="#166534"
              strokeWidth={1}
            />
            <text
              x={b.x + b.w / 2}
              y={PAD_T + INNER_H + 18}
              textAnchor="middle"
              fill="#3b352d"
              fontSize={11}
            >
              {b.year}
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
          {tr(xAxisLabel)}
        </text>
      </svg>
    </div>
  );
}
