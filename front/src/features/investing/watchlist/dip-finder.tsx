"use client";

import { PERIODS, type Period } from "@/features/investing/watchlist/data";
import { useT } from "@/lib/i18n";

type Bar = { ticker: string; value: number | undefined };

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

/** Price change of every watchlist ticker over one period, best to worst: dips are the red bars. */
export function DipFinder({
  bars,
  period,
  onPeriod,
  selected,
  onSelect,
  loading,
}: {
  bars: Bar[];
  period: Period;
  onPeriod: (p: Period) => void;
  selected: string | null;
  onSelect: (ticker: string) => void;
  loading: boolean;
}) {
  const t = useT();
  const known = bars.filter((b): b is { ticker: string; value: number } => b.value != null).sort((a, b) => b.value - a.value);
  const missing = bars.filter((b) => b.value == null).map((b) => b.ticker);

  // Headroom so the value labels above / below the longest bars stay inside the chart.
  const maxV = Math.max(0, ...known.map((b) => b.value));
  const minV = Math.min(0, ...known.map((b) => b.value));
  const span = maxV - minV || 1;
  const hi = maxV > 0 ? maxV + span * 0.08 : 0;
  const lo = minV < 0 ? minV - span * 0.12 : 0;
  const step = niceStep((hi - lo) / 5 || 5);
  const top = hi || step;
  const bottom = lo;
  const y = (v: number) => ((top - v) / (top - bottom)) * 100;
  const ticks: number[] = [];
  for (let v = Math.ceil(bottom / step) * step; v <= top; v += step) ticks.push(Math.round(v * 100) / 100);

  return (
    <section className={card}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("Dip Finder")}</h2>
          <p className="mt-0.5 text-xs text-[#8f8676]">{t("Price change over the period — red bars are the dips")}</p>
        </div>
        <div className="flex flex-wrap rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label={t("Period")}>
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriod(p)}
              aria-pressed={p === period}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${p === period ? "bg-[#1f1c17] text-white" : "text-[#6f675b] hover:bg-[#faf8f2]"}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {known.length === 0 ? (
        <p className="py-16 text-center text-sm text-[#8f8676]">{loading ? t("Loading…") : t("No price history for these tickers yet.")}</p>
      ) : (
        <div className="mt-4 overflow-x-auto pt-2">
          <div className="flex" style={{ minWidth: 48 + known.length * 44 }}>
            <div className="relative h-56 w-12 shrink-0 text-right text-[10px] tabular-nums text-[#8f8676]">
              {ticks.map((v) => (
                <span key={v} className="absolute right-2 -translate-y-1/2" style={{ top: `${y(v)}%` }}>
                  {v}%
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative h-56">
                {ticks.map((v) => (
                  <div key={v} className={`absolute inset-x-0 border-t ${v === 0 ? "border-[#1f1c17]/30" : "border-black/5"}`} style={{ top: `${y(v)}%` }} />
                ))}
                <div className="absolute inset-0 flex justify-around">
                  {known.map((b) => {
                    const up = b.value >= 0;
                    const active = b.ticker === selected;
                    return (
                      <button
                        key={b.ticker}
                        type="button"
                        onClick={() => onSelect(b.ticker)}
                        className="group relative h-full max-w-[96px] flex-1"
                        title={`${b.ticker}: ${b.value > 0 ? "+" : ""}${b.value.toFixed(2)}%`}
                      >
                        <span
                          className={`absolute inset-x-[14%] rounded-[3px] transition ${up ? "bg-emerald-500/75 group-hover:bg-emerald-500" : "bg-rose-500/75 group-hover:bg-rose-500"} ${active ? "ring-2 ring-[#1f1c17] ring-offset-1" : ""}`}
                          style={{ top: `${y(Math.max(b.value, 0))}%`, height: `${Math.max(0.6, Math.abs(y(b.value) - y(0)))}%` }}
                        />
                        <span
                          className={`absolute inset-x-0 text-center text-[10px] font-medium tabular-nums ${up ? "text-emerald-800" : "text-rose-800"}`}
                          style={up ? { top: `calc(${y(b.value)}% - 15px)` } : { top: `calc(${y(b.value)}% + 3px)` }}
                        >
                          {b.value > 0 ? "+" : ""}
                          {Math.abs(b.value) >= 100 ? b.value.toFixed(0) : b.value.toFixed(1)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-1.5 flex justify-around">
                {known.map((b) => (
                  <button
                    key={b.ticker}
                    type="button"
                    onClick={() => onSelect(b.ticker)}
                    className={`max-w-[96px] flex-1 truncate text-center text-[11px] ${b.ticker === selected ? "font-semibold text-[#1f1c17]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
                  >
                    {b.ticker}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {missing.length && known.length ? (
        <p className="mt-2 text-[11px] text-[#8f8676]">{t("No {period} data: {list}", { period, list: missing.join(", ") })}</p>
      ) : null}
    </section>
  );
}
