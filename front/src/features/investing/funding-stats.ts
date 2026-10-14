import { parseInvestingDateMs, parseUsd } from "@/features/investing/format";
import type { InvestingActivityYearSummary, InvestingRefillRow } from "@/state/investing-store";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Money-weighted annual return (XIRR): deposits are outflows on their dates, `currentValue` is the inflow today.
 * Returns a fraction (0.12 = 12%/yr), or null when it can't be computed.
 */
export function xirrFromRefills(refills: InvestingRefillRow[], currentValue: number, nowMs = Date.now()): number | null {
  const flows = refills
    .map((r) => ({ t: parseInvestingDateMs(r.date), amount: parseUsd(r.amount) }))
    .filter((f): f is { t: number; amount: number } => f.t != null && f.amount > 0);
  if (flows.length === 0 || currentValue <= 0) return null;

  const t0 = Math.min(...flows.map((f) => f.t));
  if ((nowMs - t0) / DAY_MS < 30) return null; // too short to annualize meaningfully
  const npv = (rate: number) =>
    currentValue / Math.pow(1 + rate, (nowMs - t0) / DAY_MS / 365) -
    flows.reduce((a, f) => a + f.amount / Math.pow(1 + rate, (f.t - t0) / DAY_MS / 365), 0);

  // NPV is monotonically decreasing in rate here (one sign change), so bisection is safe.
  let lo = -0.99;
  let hi = 10;
  if (npv(lo) < 0 || npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export type RefillYearRow = {
  year: number;
  sum: number;
  count: number;
  commission: number;
  cumulative: number;
  /** Change vs previous year's sum, % (null for the first year or when previous was 0). */
  yoyPct: number | null;
};

export function refillsByYear(refills: InvestingRefillRow[]): RefillYearRow[] {
  const by = new Map<number, { sum: number; count: number; commission: number }>();
  for (const r of refills) {
    const t = parseInvestingDateMs(r.date);
    if (t == null) continue;
    const y = new Date(t).getUTCFullYear();
    const cur = by.get(y) ?? { sum: 0, count: 0, commission: 0 };
    cur.sum += parseUsd(r.amount);
    cur.commission += parseUsd(r.commission);
    cur.count += 1;
    by.set(y, cur);
  }
  if (by.size === 0) return [];
  const years = [...by.keys()].sort((a, b) => a - b);
  const out: RefillYearRow[] = [];
  let cumulative = 0;
  for (let y = years[0]!; y <= years[years.length - 1]!; y++) {
    const cur = by.get(y) ?? { sum: 0, count: 0, commission: 0 };
    cumulative += cur.sum;
    const prev = out[out.length - 1];
    out.push({
      year: y,
      ...cur,
      cumulative,
      yoyPct: prev && prev.sum > 0 ? ((cur.sum - prev.sum) / prev.sum) * 100 : null,
    });
  }
  return out;
}

export type YearPace = {
  year: number;
  ytd: number;
  count: number;
  /** Same calendar window (Jan 1 → today's day-of-year) one year earlier. */
  lastYearYtd: number;
  avgPerMonth: number;
  projected: number;
  lastRefillMs: number | null;
};

export function currentYearPace(refills: InvestingRefillRow[], nowMs = Date.now()): YearPace {
  const now = new Date(nowMs);
  const year = now.getUTCFullYear();
  const startThis = Date.UTC(year, 0, 1);
  const startPrev = Date.UTC(year - 1, 0, 1);
  const elapsed = nowMs - startThis;
  let ytd = 0;
  let count = 0;
  let lastYearYtd = 0;
  let lastRefillMs: number | null = null;
  for (const r of refills) {
    const t = parseInvestingDateMs(r.date);
    if (t == null) continue;
    const amount = parseUsd(r.amount);
    if (t >= startThis && t <= nowMs) {
      ytd += amount;
      count += 1;
    } else if (t >= startPrev && t <= startPrev + elapsed) {
      lastYearYtd += amount;
    }
    if (t <= nowMs && (lastRefillMs == null || t > lastRefillMs)) lastRefillMs = t;
  }
  const yearFraction = Math.max(elapsed / (Date.UTC(year + 1, 0, 1) - startThis), 1 / 365);
  return {
    year,
    ytd,
    count,
    lastYearYtd,
    avgPerMonth: ytd / Math.max(1, now.getUTCMonth() + now.getUTCDate() / 31),
    projected: ytd / yearFraction,
    lastRefillMs,
  };
}

export type FlowYearRow = {
  year: string;
  deposited: number;
  bought: number;
  sold: number;
  fees: number;
  /** Deposits − buys + sales − trade fees, this year. */
  netCash: number;
  /** Running total of netCash: deposited money not (yet) in positions. */
  unspent: number;
};

/** Reconciles refills with trade activity per year: where deposited money went. */
export function depositsVsBuys(
  refillYears: RefillYearRow[],
  activityYears: InvestingActivityYearSummary[],
): FlowYearRow[] {
  const years = new Set<string>([...refillYears.map((r) => String(r.year)), ...activityYears.map((a) => a.year)]);
  const deposits = new Map(refillYears.map((r) => [String(r.year), r.sum]));
  const acts = new Map(activityYears.map((a) => [a.year, a]));
  let unspent = 0;
  return [...years]
    .filter((y) => /^\d{4}$/.test(y))
    .sort()
    .map((year) => {
      const a = acts.get(year);
      const deposited = deposits.get(year) ?? 0;
      const bought = a ? parseUsd(a.purchases_amount) : 0;
      const sold = a ? parseUsd(a.sales_amount) : 0;
      const fees = a ? parseUsd(a.purchases_commission) + parseUsd(a.sales_commission) : 0;
      const netCash = deposited - bought + sold - fees;
      unspent += netCash;
      return { year, deposited, bought, sold, fees, netCash, unspent };
    });
}
