"use client";

import { useState } from "react";

const BAR = "#2a78d6";

/** Single-series horizontal bars with the value printed at the end; hover shows the exact share. */
export function HBars({ rows, total, unit }: { rows: [string, number][]; total: number; unit: string }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <ul className="space-y-1.5">
      {rows.map(([label, n]) => (
        <li key={label} className="group grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-2 text-xs" title={`${label}: ${n} ${unit} (${Math.round((n / total) * 100)}%)`}>
          <span className="truncate text-[#3b352d]">{label}</span>
          <span className="h-3 rounded-r bg-[#f3efe5]">
            <span className="block h-full rounded-r transition-opacity group-hover:opacity-80" style={{ width: `${(n / max) * 100}%`, background: BAR }} />
          </span>
          <span className="text-right tabular-nums text-[#6f675b]">{n}</span>
        </li>
      ))}
    </ul>
  );
}

/** Single-series vertical bars (one per year or score), every bar hoverable, values labelled on hover and at the peak. */
export function VBars({ rows, unit, empty }: { rows: [string, number][]; unit: string; empty: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!rows.length) return <p className="text-xs text-[#8f8676]">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const peak = rows.findIndex((r) => r[1] === max);
  return (
    <div>
      <div className="flex h-32 items-end gap-[2px] border-b border-black/10" onMouseLeave={() => setHover(null)}>
        {rows.map(([label, n], i) => (
          <div
            key={label}
            className="relative flex h-full flex-1 cursor-default flex-col justify-end"
            onMouseEnter={() => setHover(i)}
            aria-label={`${label}: ${n} ${unit}`}
          >
            {hover === i || (hover == null && i === peak) ? (
              <span className="absolute inset-x-0 -top-0.5 z-10 -translate-y-full text-center text-[11px] font-medium tabular-nums text-[#1f1c17]">
                {n}
              </span>
            ) : null}
            <span
              className="mx-auto block w-full max-w-12 rounded-t-[4px] transition-opacity"
              style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, background: BAR, opacity: hover == null || hover === i ? 1 : 0.45 }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] tabular-nums text-[#8f8676]">
        {rows.map(([label], i) => (
          <span key={label} className="flex-1 text-center">
            {rows.length <= 12 || i % Math.ceil(rows.length / 10) === 0 || i === rows.length - 1 ? label : ""}
          </span>
        ))}
      </div>
      <p className="mt-1 h-4 text-[11px] text-[#6f675b]">{hover != null ? `${rows[hover][0]}: ${rows[hover][1]} ${unit}` : ""}</p>
    </div>
  );
}
