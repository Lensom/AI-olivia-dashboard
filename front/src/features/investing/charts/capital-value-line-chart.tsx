"use client";

import { useId, useMemo } from "react";
import { useT } from "@/lib/i18n";

export type CapitalValuePoint = {
  label: string;
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

/** Left padding for Y tick labels */
const PAD_L = 52;
/** Right padding — room for last X label (textAnchor middle extends past last point) */
const PAD_R = 56;
const PAD_T = 28;
/** Bottom padding for rotated / multi-line date ticks */
const PAD_B = 56;
const INNER_W = 520;
const INNER_H = 200;
/** Keep line and markers inside the plot so caps are not clipped at the top edge */
const PLOT_PAD_X = 14;
const PLOT_PAD_Y = 12;

function buildStepAfterPath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return "";
  const first = pts[0]!;
  if (pts.length === 1) return `M ${first.x} ${first.y}`;
  let d = `M ${first.x} ${first.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    d += ` L ${b.x} ${a.y} L ${b.x} ${b.y}`;
  }
  return d;
}

export function CapitalValueLineChart({
  title = "Portfolio value over time",
  subtitle = "From capital tracking entries (total value).",
  data,
}: {
  title?: string;
  subtitle?: string;
  data: CapitalValuePoint[];
}) {
  const clipId = useId().replace(/:/g, "");
  const tr = useT();

  const { pathD, circles, ticks, tickYs, viewW, viewH, xLabels } = useMemo(() => {
    const viewW = INNER_W + PAD_L + PAD_R;
    const viewH = INNER_H + PAD_T + PAD_B;
    const n = data.length;
    if (n === 0) {
      return {
        pathD: "",
        circles: [] as { cx: number; cy: number }[],
        ticks: [] as number[],
        tickYs: [] as number[],
        viewW,
        viewH,
        xLabels: [],
      };
    }
    const maxVal = Math.max(...data.map((d) => d.value));
    const yMax = niceYMax(maxVal);
    const tickCount = 5;
    const ticks = Array.from({ length: tickCount }, (_, i) => (yMax * i) / (tickCount - 1));

    const plotW = INNER_W - 2 * PLOT_PAD_X;
    const plotH = INNER_H - 2 * PLOT_PAD_Y;

    const xAt = (i: number) => {
      if (n <= 1) return PAD_L + INNER_W / 2;
      return PAD_L + PLOT_PAD_X + (i / (n - 1)) * plotW;
    };
    const yAt = (v: number) => PAD_T + PLOT_PAD_Y + plotH - (v / yMax) * plotH;

    const pts = data.map((d, i) => ({ x: xAt(i), y: yAt(d.value) }));
    const pathD = buildStepAfterPath(pts);
    const circles = pts;
    const tickYs = ticks.map((tv) => yAt(tv));

    const maxLabels = 8;
    const step = n <= maxLabels ? 1 : Math.ceil(n / maxLabels);
    const xLabels = data
      .map((d, i) => ({ label: d.label, x: xAt(i), show: i % step === 0 || i === n - 1 }))
      .filter((x) => x.show);

    return { pathD, circles, ticks, tickYs, viewW, viewH, xLabels };
  }, [data]);

  if (data.length === 0) {
    return (
      <article className="flex h-full min-h-[300px] flex-col rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr(title)}</h2>
          <span className="rounded-xl border border-black/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#6f675b]">
            {tr("Capital")}
          </span>
        </div>
        <p className="mt-1 text-xs text-[#655d51]">{tr(subtitle)}</p>
        <p className="mt-10 text-center text-sm text-[#7f7668]">
          {tr("On the Dashboard, add capital rows with a date (e.g. 15.03.2024 or 2024-03-15) and total value.")}
        </p>
      </article>
    );
  }

  return (
    <article className="flex h-full flex-col rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#1f1c17]">{tr(title)}</h2>
        <span className="rounded-xl border border-black/10 bg-white/70 px-2.5 py-1 text-[11px] font-medium text-[#6f675b]">
          {tr("Capital")}
        </span>
      </div>
      <p className="mt-1 text-xs text-[#655d51]">{tr(subtitle)}</p>
      <svg
        className="mx-auto mt-3 w-full max-w-full overflow-visible"
        viewBox={`0 0 ${viewW} ${viewH}`}
        role="img"
        aria-label={tr(title)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_L} y={PAD_T} width={INNER_W} height={INNER_H} />
          </clipPath>
        </defs>
        <rect x="0" y="0" width={viewW} height={viewH} fill="#ffffff" />
        {ticks.map((tv, idx) => {
          const gy = tickYs[idx] ?? 0;
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
        <g clipPath={`url(#${clipId})`}>
          <path
            d={pathD}
            fill="none"
            stroke="#4f46e5"
            strokeWidth={2.5}
            strokeLinejoin="miter"
            strokeLinecap="butt"
          />
          {circles.map((c, i) => (
            <circle key={i} cx={c.cx} cy={c.cy} r={3.5} fill="#ffffff" stroke="#4f46e5" strokeWidth={2} />
          ))}
        </g>
        {xLabels.map((xl, i) => (
          <text
            key={`${xl.label}-${i}`}
            x={xl.x}
            y={PAD_T + INNER_H + 16}
            textAnchor="middle"
            fill="#3b352d"
            fontSize={10}
          >
            {xl.label}
          </text>
        ))}
        <text
          x={PAD_L + INNER_W / 2}
          y={viewH - 10}
          textAnchor="middle"
          fill="#655d51"
          fontSize={11}
        >
          Date
        </text>
      </svg>
    </article>
  );
}
