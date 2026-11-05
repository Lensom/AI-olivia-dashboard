"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Point } from "@/features/investing/stock/data";
import { useLocale, useT } from "@/lib/i18n";

/** Validated with the dataviz palette check against the white card surface. */
export const SERIES_BLUE = "#2a78d6";
export const SERIES_ORANGE = "#c8651b";

const UP = "#059669";
const DOWN = "#e11d48";
const GRID = "bg-black/[0.06]";
const AXIS_TEXT = "text-[10px] tabular-nums text-[#8f8676]";

function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (lo === hi) hi = lo + (Math.abs(lo) || 1);
  const rough = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const unit = rough / mag;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v < hi + step * 0.999; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function Tooltip({ children, align }: { children: ReactNode; align: "left" | "center" | "right" }) {
  const pos = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";
  return (
    <div className={`pointer-events-none absolute top-0 z-20 w-max max-w-[240px] rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] leading-snug text-[#3b352d] shadow-[0_6px_20px_rgba(18,16,13,0.12)] ${pos}`}>
      {children}
    </div>
  );
}

export type BarSeries = { name: string; color: string; points: Point[] };

/** Columns from a zero baseline, one or two series side by side; hover or focus a period for its values. */
export function BarChart({
  series,
  format,
  axisFormat,
  periodLabel,
}: {
  series: BarSeries[];
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  periodLabel: (period: string) => string;
}) {
  const t = useT();
  const [active, setActive] = useState<number | null>(null);
  const periods = useMemo(() => [...new Set(series.flatMap((s) => s.points.map((p) => p.period)))].sort(), [series]);
  const lookup = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.period, p.value]))), [series]);

  if (!periods.length) return <p className={`flex h-44 items-center justify-center text-xs text-[#8f8676]`}>{t("No data reported.")}</p>;

  const values = series.flatMap((s) => s.points.map((p) => p.value));
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const zero = at(0);
  const axis = axisFormat ?? format;

  return (
    <div className="pt-2">
      <div className="flex gap-2">
        <div className="relative h-36 w-11 shrink-0" aria-hidden>
          {ticks.map((v) => (
            <span key={v} className={`absolute right-0 ${AXIS_TEXT}`} style={{ bottom: `calc(${at(v)}% - 0.65em)` }}>
              {axis(v)}
            </span>
          ))}
        </div>
        <div className="relative h-36 min-w-0 flex-1">
          {ticks.map((v) => (
            <div key={v} aria-hidden className={`absolute inset-x-0 h-px ${v === 0 ? "bg-black/25" : GRID}`} style={{ bottom: `${at(v)}%` }} />
          ))}
          <div className="absolute inset-0 flex" onMouseLeave={() => setActive(null)}>
            {periods.map((period, i) => {
              const label = periodLabel(period);
              const summary = series.map((s, k) => `${s.name} ${lookup[k].has(period) ? format(lookup[k].get(period)!) : "—"}`).join(", ");
              return (
                <div
                  key={period}
                  tabIndex={0}
                  role="img"
                  aria-label={`${label}: ${summary}`}
                  onMouseEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className={`relative flex min-w-0 flex-1 justify-center gap-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-[#2a78d6] ${active === i ? "bg-black/[0.03]" : ""}`}
                >
                  {series.map((s, k) => {
                    const v = lookup[k].get(period);
                    if (v == null) return <span key={s.name} className="relative h-full w-full max-w-5" />;
                    const up = v >= 0;
                    return (
                      <span key={s.name} className="relative h-full w-full max-w-5">
                        <span
                          className={`absolute inset-x-0 ${up ? "rounded-t" : "rounded-b"}`}
                          style={{
                            background: s.color,
                            bottom: `${up ? zero : at(v)}%`,
                            height: `${Math.max(Math.abs(at(v) - zero), 0.5)}%`,
                          }}
                        />
                      </span>
                    );
                  })}
                  {active === i ? (
                    <Tooltip align={i < periods.length / 3 ? "left" : i >= (periods.length * 2) / 3 ? "right" : "center"}>
                      <p className="font-semibold text-[#1f1c17]">{label}</p>
                      {series.map((s, k) => (
                        <p key={s.name} className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                          {series.length > 1 ? <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden /> : null}
                          {series.length > 1 ? `${s.name}: ` : ""}
                          {lookup[k].has(period) ? format(lookup[k].get(period)!) : "—"}
                        </p>
                      ))}
                    </Tooltip>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1 flex gap-2" aria-hidden>
        <span className="w-11 shrink-0" />
        <div className="flex min-w-0 flex-1">
          {periods.map((period) => (
            <span key={period} className={`min-w-0 flex-1 truncate text-center ${AXIS_TEXT}`}>
              {periodLabel(period)}
            </span>
          ))}
        </div>
      </div>
      {series.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#6f675b]">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type PriceLevel = { value: number; name: string; color: string };
export type PriceMark = { date: string; kind: "buy" | "sell"; value: number; count: number };

/** Closing prices with a crosshair; optional horizontal levels (your buy prices) and sized marks (insider trades). */
export function PriceChart({
  points,
  levels = [],
  marks = [],
  format,
  markFormat,
  loading,
  height = "h-56",
}: {
  points: [number, number][];
  levels?: PriceLevel[];
  marks?: PriceMark[];
  format: (v: number) => string;
  markFormat?: (v: number) => string;
  loading?: boolean;
  height?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [active, setActive] = useState<number | null>(null);

  // Trades fall on days the market may be closed: each lands on the nearest trading day shown.
  const placed = useMemo(() => {
    if (points.length < 2) return [];
    const first = points[0][0];
    const last = points[points.length - 1][0];
    const byIndex = new Map<string, { i: number; kind: "buy" | "sell"; value: number; count: number }>();
    for (const m of marks) {
      const ts = Date.parse(`${m.date}T00:00:00Z`) / 1000;
      if (ts < first - 86400 || ts > last + 86400) continue;
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(points[i][0] - ts) < Math.abs(points[best][0] - ts)) best = i;
      const key = `${best}:${m.kind}`;
      const cur = byIndex.get(key);
      byIndex.set(key, { i: best, kind: m.kind, value: (cur?.value ?? 0) + m.value, count: (cur?.count ?? 0) + m.count });
    }
    return [...byIndex.values()];
  }, [points, marks]);

  if (points.length < 2) {
    return <p className={`flex items-center justify-center text-xs text-[#8f8676] ${height}`}>{loading ? t("Loading…") : t("No price history.")}</p>;
  }

  const closes = points.map((p) => p[1]);
  const visibleLevels = levels.filter((l) => Number.isFinite(l.value));
  const ticks = niceTicks(Math.min(...closes), Math.max(...closes));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const W = 1000;
  const H = 100;
  const px = (i: number) => (i / (closes.length - 1)) * 100;
  const py = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const line = closes.map((v, i) => `${i ? "L" : "M"}${(px(i) * W) / 100},${H - py(v)}`).join(" ");
  const color = closes[closes.length - 1] >= closes[0] ? UP : DOWN;
  const inView = visibleLevels.filter((l) => l.value >= lo && l.value <= hi);
  const maxMark = Math.max(1, ...placed.map((m) => m.value));
  const spanDays = (points[points.length - 1][0] - points[0][0]) / 86400;
  const dateText = (ts: number, full = false) =>
    new Date(ts * 1000).toLocaleDateString(locale, full ? { day: "numeric", month: "short", year: "numeric" } : spanDays > 800 ? { month: "short", year: "numeric" } : { day: "numeric", month: "short" });
  const activeMarks = active == null ? [] : placed.filter((m) => m.i === active);
  const axisIdx = [0, Math.round((closes.length - 1) / 2), closes.length - 1];

  return (
    <div>
      <div className="flex gap-2">
        <div className={`relative w-12 shrink-0 ${height}`} aria-hidden>
          {ticks.map((v) => (
            <span key={v} className={`absolute right-0 ${AXIS_TEXT}`} style={{ bottom: `calc(${py(v)}% - 0.65em)` }}>
              {format(v).replace(/\.00(?=\D*$)/, "")}
            </span>
          ))}
        </div>
        <div
          className={`relative min-w-0 flex-1 touch-pan-y ${height}`}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            setActive(Math.max(0, Math.min(closes.length - 1, Math.round(((e.clientX - box.left) / box.width) * (closes.length - 1)))));
          }}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((v) => (
            <div key={v} aria-hidden className={`absolute inset-x-0 h-px ${GRID}`} style={{ bottom: `${py(v)}%` }} />
          ))}
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={t("Price trend")}>
            <path d={`${line} L${W},${H} L0,${H} Z`} fill={color} fillOpacity="0.1" />
            <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {inView.map((l) => (
              <line key={l.name} x1="0" x2={W} y1={H - py(l.value)} y2={H - py(l.value)} stroke={l.color} strokeDasharray="5 4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {placed.map((m) => {
            const size = 8 + Math.sqrt(m.value / maxMark) * 26;
            return (
              <span
                key={`${m.i}:${m.kind}`}
                aria-hidden
                className="pointer-events-none absolute -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white"
                style={{ left: `${px(m.i)}%`, bottom: `${py(closes[m.i])}%`, width: size, height: size, background: m.kind === "buy" ? UP : DOWN, opacity: 0.55 }}
              />
            );
          })}
          {active != null ? (
            <>
              <div aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-black/20" style={{ left: `${px(active)}%` }} />
              <span
                aria-hidden
                className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 translate-y-1/2 rounded-full border-2 border-white"
                style={{ left: `${px(active)}%`, bottom: `${py(closes[active])}%`, background: color }}
              />
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute top-0" style={px(active) < 50 ? { left: `calc(${px(active)}% + 10px)` } : { right: `calc(${100 - px(active)}% + 10px)` }}>
                  <div className="relative">
                    <div className="w-max max-w-[240px] rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] leading-snug text-[#3b352d] shadow-[0_6px_20px_rgba(18,16,13,0.12)]">
                      <p className="font-semibold tabular-nums text-[#1f1c17]">{format(closes[active])}</p>
                      <p className="text-[#8f8676]">{dateText(points[active][0], true)}</p>
                      {activeMarks.map((m) => (
                        <p key={m.kind} className="mt-0.5 tabular-nums">
                          {t(m.kind === "buy" ? "Insiders bought {v}" : "Insiders sold {v}", { v: markFormat ? markFormat(m.value) : format(m.value) })}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex gap-2" aria-hidden>
        <span className="w-12 shrink-0" />
        <div className={`flex min-w-0 flex-1 justify-between ${AXIS_TEXT}`}>
          {axisIdx.map((i) => (
            <span key={i}>{dateText(points[i][0])}</span>
          ))}
        </div>
      </div>
      {visibleLevels.length ? (
        <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#6f675b]">
          {visibleLevels.map((l) => (
            <span key={l.name} className="inline-flex items-center gap-1.5 tabular-nums">
              <span className="w-4 border-t-2 border-dashed" style={{ borderColor: l.color }} aria-hidden />
              {l.name} {format(l.value)}
              {l.value < lo || l.value > hi ? <span className="text-[#8f8676]">({t("outside this period")})</span> : null}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
