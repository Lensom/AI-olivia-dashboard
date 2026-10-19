"use client";

import { useT } from "@/lib/i18n";
import { useMemo, useState } from "react";
import { formatUsd } from "@/features/investing/format";

/** Categorical slots 1–2 of the validated palette: blue = you, orange = comparison series. */
export const SERIES_YOU = "#2a78d6";
export const SERIES_OTHER = "#eb6834";

const W = 640;
const H = 260;
const PAD = { l: 52, r: 16, t: 16, b: 34 };
const IW = W - PAD.l - PAD.r;
const IH = H - PAD.t - PAD.b;

function niceStep(range: number, ticks = 4): number {
  const raw = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw || 1));
  return ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag) || 1;
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-[#6f675b]">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-4 border-t-2"
            style={{ borderColor: it.color, borderStyle: it.dashed ? "dashed" : "solid" }}
          />
          {t(it.label)}
        </span>
      ))}
    </div>
  );
}

export type AnnualReturnPoint = { label: string; you: number | null; benchmark: number | null };

/** Grouped bars per year around a zero baseline: your return vs the benchmark's. */
export function AnnualReturnsChart({ data, benchmarkLabel }: { data: AnnualReturnPoint[]; benchmarkLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();
  const { yMin, yMax, ticks } = useMemo(() => {
    const vals = data.flatMap((d) => [d.you, d.benchmark]).filter((v): v is number => v != null);
    const lo = Math.min(0, ...vals);
    const hi = Math.max(0, ...vals);
    const step = niceStep(hi - lo || 10);
    const yMin = Math.floor(lo / step) * step;
    const yMax = Math.ceil(hi / step) * step || step;
    const ticks: number[] = [];
    for (let v = yMin; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
    return { yMin, yMax, ticks };
  }, [data]);

  const y = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin || 1)) * IH;
  const band = IW / Math.max(1, data.length);
  const barW = Math.min(22, (band - 14) / 2);
  const hovered = hover != null ? data[hover] : null;

  return (
    <div>
      <Legend
        items={[
          { label: "Your portfolio", color: SERIES_YOU },
          { label: benchmarkLabel, color: SERIES_OTHER },
        ]}
      />
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("Annual return by year")}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.06)"} />
              <text x={PAD.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#8f8676">
                {t > 0 ? "+" : ""}
                {t}%
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = PAD.l + band * i + band / 2;
            const bar = (v: number | null, x: number, color: string) => {
              if (v == null) return null;
              const top = Math.min(y(v), y(0));
              const h = Math.max(1, Math.abs(y(v) - y(0)));
              return <rect x={x} y={top} width={barW} height={h} rx={3} fill={color} />;
            };
            return (
              <g key={d.label}>
                {hover === i ? (
                  <rect x={cx - band / 2} y={PAD.t} width={band} height={IH} fill="rgba(0,0,0,0.04)" />
                ) : null}
                {bar(d.you, cx - barW - 1, SERIES_YOU)}
                {bar(d.benchmark, cx + 1, SERIES_OTHER)}
                <text x={cx} y={H - 12} textAnchor="middle" fontSize="11" fill="#6f675b">
                  {d.label}
                </text>
                <rect
                  x={cx - band / 2}
                  y={PAD.t}
                  width={band}
                  height={IH + 20}
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
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-md"
            style={{ left: `${((PAD.l + band * hover + band / 2) / W) * 100}%`, transform: "translateX(-50%)" }}
          >
            <p className="font-semibold text-[#1f1c17]">{hovered.label}</p>
            <p className="tabular-nums text-[#3b352d]">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES_YOU }} />
              {t("You")} {hovered.you == null ? "—" : `${hovered.you > 0 ? "+" : ""}${hovered.you.toFixed(1)}%`}
            </p>
            <p className="tabular-nums text-[#3b352d]">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: SERIES_OTHER }} />
              {benchmarkLabel}{" "}
              {hovered.benchmark == null ? "—" : `${hovered.benchmark > 0 ? "+" : ""}${hovered.benchmark.toFixed(1)}%`}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type ValueInvestedPoint = { label: string; value: number; invested: number };

/** Two $ series on one axis: portfolio value vs cumulative money put in. The gap is the gain. */
export function ValueVsInvestedChart({ data }: { data: ValueInvestedPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const t = useT();
  const { yMax, ticks } = useMemo(() => {
    const hi = Math.max(1, ...data.flatMap((d) => [d.value, d.invested]));
    const step = niceStep(hi);
    const yMax = Math.ceil(hi / step) * step;
    const ticks: number[] = [];
    for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(v);
    return { yMax, ticks };
  }, [data]);

  const x = (i: number) => PAD.l + (data.length <= 1 ? IW / 2 : (i / (data.length - 1)) * IW);
  const y = (v: number) => PAD.t + (1 - v / yMax) * IH;
  const path = (key: "value" | "invested") => data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d[key])}`).join(" ");
  const hovered = hover != null ? data[hover] : null;

  return (
    <div>
      <Legend
        items={[
          { label: "Portfolio value", color: SERIES_YOU },
          { label: "Money invested", color: SERIES_OTHER, dashed: true },
        ]}
      />
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t("Portfolio value vs money invested")}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(0,0,0,0.06)" />
              <text x={PAD.l - 8} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#8f8676">
                {t >= 1000 ? `$${(t / 1000).toFixed(t % 1000 ? 1 : 0)}k` : `$${t}`}
              </text>
            </g>
          ))}
          <path
            d={`${path("value")} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
            fill={SERIES_YOU}
            opacity={0.08}
          />
          <path d={path("invested")} fill="none" stroke={SERIES_OTHER} strokeWidth={2} strokeDasharray="5 4" />
          <path d={path("value")} fill="none" stroke={SERIES_YOU} strokeWidth={2} />
          {hover != null ? (
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + IH} stroke="rgba(0,0,0,0.25)" />
          ) : null}
          {data.map((d, i) => (
            <g key={d.label}>
              <circle cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 3.5} fill={SERIES_YOU} stroke="#fff" strokeWidth={2} />
              <circle cx={x(i)} cy={y(d.invested)} r={hover === i ? 5 : 3.5} fill={SERIES_OTHER} stroke="#fff" strokeWidth={2} />
              <text x={x(i)} y={H - 12} textAnchor="middle" fontSize="11" fill="#6f675b">
                {d.label}
              </text>
              <rect
                x={x(i) - IW / Math.max(2, data.length) / 2}
                y={PAD.t}
                width={IW / Math.max(2, data.length)}
                height={IH + 20}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          ))}
        </svg>
        {hovered && hover != null ? (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(x(hover) / W) * 100}%`,
              transform: hover > data.length / 2 ? "translateX(-105%)" : "translateX(5%)",
            }}
          >
            <p className="font-semibold text-[#1f1c17]">{hovered.label}</p>
            <p className="tabular-nums text-[#3b352d]">{t("Value")} {formatUsd(hovered.value)}</p>
            <p className="tabular-nums text-[#3b352d]">{t("Invested")} {formatUsd(hovered.invested)}</p>
            <p className={`tabular-nums ${hovered.value >= hovered.invested ? "text-emerald-700" : "text-rose-700"}`}>
              {t("Gain")} {hovered.value - hovered.invested >= 0 ? "+" : ""}
              {formatUsd(hovered.value - hovered.invested)}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
