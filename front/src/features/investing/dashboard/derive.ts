import type { InvestingHolding } from "@/features/investing/types";
import { parsePercent, parseUsd } from "@/features/investing/format";

export type Position = {
  id: string;
  ticker: string;
  name: string;
  industry: string;
  shares: number;
  price: number;
  value: number;
  cost: number;
  pnl: number;
  /** Total return on cost, %. */
  pnlPct: number;
  /** Share of portfolio value, %. */
  weight: number;
  /** Target weight, %. 0 when not set. */
  target: number;
  /** Today's session move, % (null when no quote yet). */
  dayPct: number | null;
  /** Today's move in $ for the whole position (null when no quote yet). */
  dayUsd: number | null;
};

export function parseDayPct(s: string | undefined): number | null {
  const raw = String(s ?? "").trim();
  if (!raw || raw === "—") return null;
  const n = Number.parseFloat(raw.replace(/[%+]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function buildPositions(holdings: InvestingHolding[]): Position[] {
  const total = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
  return holdings
    .filter((h) => (h.ticker ?? "").trim() && h.shares > 0)
    .map((h) => {
      const value = parseUsd(h.marketValue);
      const cost = h.shares * parseUsd(h.avgBuyPrice);
      const dayPct = parseDayPct(h.dayChangePercent);
      const industry = (h.industry ?? "").trim();
      return {
        id: h.id,
        ticker: h.ticker.trim().toUpperCase(),
        name: h.name,
        industry: industry && industry !== "—" ? industry : "Unclassified",
        shares: h.shares,
        price: parseUsd(h.marketPrice),
        value,
        cost,
        pnl: value - cost,
        pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
        weight: total > 0 ? (value / total) * 100 : 0,
        target: Math.max(0, parsePercent(h.targetWeight ?? "")),
        // value = prev * (1 + d) → move = value - prev
        dayPct,
        dayUsd: dayPct == null ? null : value - value / (1 + dayPct / 100),
      };
    });
}

export type PortfolioTotals = {
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
  dayUsd: number;
  dayPct: number;
  hasQuotes: boolean;
  up: number;
  down: number;
  inProfit: number;
  inLoss: number;
};

export function buildTotals(positions: Position[]): PortfolioTotals {
  const value = positions.reduce((a, p) => a + p.value, 0);
  const cost = positions.reduce((a, p) => a + p.cost, 0);
  const quoted = positions.filter((p) => p.dayUsd != null);
  const dayUsd = quoted.reduce((a, p) => a + (p.dayUsd ?? 0), 0);
  const prevValue = value - dayUsd;
  return {
    value,
    cost,
    pnl: value - cost,
    pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : 0,
    dayUsd,
    dayPct: prevValue > 0 ? (dayUsd / prevValue) * 100 : 0,
    hasQuotes: quoted.length > 0,
    up: quoted.filter((p) => (p.dayPct ?? 0) > 0).length,
    down: quoted.filter((p) => (p.dayPct ?? 0) < 0).length,
    inProfit: positions.filter((p) => p.pnl > 0).length,
    inLoss: positions.filter((p) => p.pnl < 0).length,
  };
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap (Bruls et al.): lays out `values` (any order) into a W×H box; rects match input order. */
export function squarify(values: number[], W: number, H: number): Rect[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  const out: Rect[] = new Array(values.length);
  if (total <= 0 || W <= 0 || H <= 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));

  const order = values
    .map((v, i) => ({ i, area: (Math.max(0, v) / total) * W * H }))
    .sort((a, b) => b.area - a.area);

  let x = 0;
  let y = 0;
  let w = W;
  let h = H;
  let row: typeof order = [];

  const worst = (r: typeof order, side: number) => {
    const s = r.reduce((a, it) => a + it.area, 0);
    const max = Math.max(...r.map((it) => it.area));
    const min = Math.min(...r.map((it) => it.area));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };

  const layoutRow = () => {
    const s = row.reduce((a, it) => a + it.area, 0);
    if (w >= h) {
      const colW = s / h;
      let cy = y;
      for (const it of row) {
        const rh = it.area / colW;
        out[it.i] = { x, y: cy, w: colW, h: rh };
        cy += rh;
      }
      x += colW;
      w -= colW;
    } else {
      const rowH = s / w;
      let cx = x;
      for (const it of row) {
        const rw = it.area / rowH;
        out[it.i] = { x: cx, y, w: rw, h: rowH };
        cx += rw;
      }
      y += rowH;
      h -= rowH;
    }
    row = [];
  };

  let k = 0;
  while (k < order.length) {
    const item = order[k]!;
    if (item.area <= 0) {
      out[item.i] = { x: 0, y: 0, w: 0, h: 0 };
      k++;
      continue;
    }
    const side = Math.min(w, h);
    if (row.length === 0 || worst([...row, item], side) <= worst(row, side)) {
      row.push(item);
      k++;
    } else {
      layoutRow();
    }
  }
  if (row.length) layoutRow();
  return out;
}
