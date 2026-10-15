"use client";

import { useMemo, useState } from "react";
import { formatUsd } from "@/features/investing/format";

const W = 760;
const H = 260;
const PAD = { l: 56, r: 12, t: 14, b: 44 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;
const BAR = "#2a78d6";

export type MonthlyTotalPoint = { key: string; label: string; value: number; change: number | null };

/** One bar per month (single series, so no legend); hover shows the value and the change from the month before. */
export function MonthlyTotalChart({ data }: { data: MonthlyTotalPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const { yMax, ticks } = useMemo(() => {
    const hi = Math.max(1, ...data.map((d) => d.value));
    const raw = hi / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
    const yMax = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
    return { yMax, ticks };
  }, [data]);

  const band = IW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, band - 6));
  const y = (v: number) => PAD.t + (1 - v / yMax) * IH;
  // Label every n-th month so labels never collide.
  const every = Math.max(1, Math.ceil(data.length / 12));
  const hovered = hover != null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Total by month">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(0,0,0,0.06)" />
            <text x={PAD.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#8f8676">
              {t >= 1000 ? `$${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : `$${t}`}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = PAD.l + band * i + band / 2;
          return (
            <g key={d.key}>
              <rect
                x={cx - barW / 2}
                y={y(d.value)}
                width={barW}
                height={Math.max(0, y(0) - y(d.value))}
                rx={4}
                fill={BAR}
                opacity={hover == null || hover === i ? 1 : 0.55}
              />
              {i % every === 0 || i === data.length - 1 ? (
                <text x={cx} y={H - 24} textAnchor="middle" fontSize="10" fill="#6f675b">
                  {d.label}
                </text>
              ) : null}
              <rect
                x={cx - band / 2}
                y={PAD.t}
                width={band}
                height={IH + 30}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover != null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-md"
          style={{
            left: `${((PAD.l + band * hover + band / 2) / W) * 100}%`,
            transform: hover > data.length / 2 ? "translateX(-105%)" : "translateX(5%)",
          }}
        >
          <p className="font-semibold text-[#1f1c17]">{hovered.label}</p>
          <p className="tabular-nums text-[#3b352d]">{formatUsd(hovered.value)}</p>
          {hovered.change != null ? (
            <p className={`tabular-nums ${hovered.change >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
              {hovered.change >= 0 ? "+" : ""}
              {formatUsd(hovered.change)} vs month before
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
