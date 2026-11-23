import { parseInvestingDateMs, parseUsd } from "@/features/investing/format";
import type {
  BrokerInterestRow,
  ExternalFeeRow,
  InvestingActivity,
  InvestingActivityYearSummary,
  InvestingRefillRow,
} from "@/state/investing-store";

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

export type FeeBreakdown = {
  refill: number;
  buy: number;
  sell: number;
  /** Fees paid outside the broker (deposit services, card exchange), typed in by hand. */
  external: number;
  /** Interest the broker charged on a negative cash balance (from Freedom24). */
  interest: number;
  /** refill + buy + sell + external + interest, before any manual override. */
  computed: number;
  /** What the app uses: the manual override if one is set, otherwise `computed`. */
  total: number;
  isOverride: boolean;
};

/** All fees paid: refill commissions plus buy and sell commissions from Activities (USD). */
export function feeBreakdown(
  refills: InvestingRefillRow[],
  activityYears: InvestingActivityYearSummary[],
  overrideUsd: string,
  externalUsd = "",
  interestUsd = "",
): FeeBreakdown {
  const refill = refills.reduce((a, r) => a + parseUsd(r.commission), 0);
  const buy = activityYears.reduce((a, y) => a + parseUsd(y.purchases_commission), 0);
  const sell = activityYears.reduce((a, y) => a + parseUsd(y.sales_commission), 0);
  const external = externalUsd.trim() ? parseUsd(externalUsd) : 0;
  const interest = interestUsd.trim() ? parseUsd(interestUsd) : 0;
  const computed = refill + buy + sell + external + interest;
  const isOverride = overrideUsd.trim() !== "";
  return { refill, buy, sell, external, interest, computed, total: isOverride ? parseUsd(overrideUsd) : computed, isOverride };
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

export type FeeKind = "refill" | "buy" | "sell" | "external" | "interest";

export type FeeRow = {
  id: string;
  kind: FeeKind;
  /** As the source wrote it (DD.MM.YYYY or YYYY-MM-DD); `ms` is null when it can't be read. */
  date: string;
  ms: number | null;
  usd: number;
  /** What it was for: the deposit, the trade, your note. */
  detail: string;
  /** For a deposit's fee: the deposit, so the detail can show it. */
  depositUsd?: number;
  ticker?: string;
  count?: number;
  /** Margin interest: one row per month, the days it was charged (dated by the last of them). */
  days?: number;
};

/**
 * Every fee with its date, from the same sources and in the same amounts as `feeBreakdown`: refill commissions,
 * buy and sell commissions from Activities (in USD, as the yearly summary counts them), fees outside the broker,
 * and margin interest. Newest first; undated ones last.
 */
export function feeRows(
  refills: InvestingRefillRow[],
  activities: InvestingActivity[],
  external: ExternalFeeRow[],
  interest: BrokerInterestRow[],
): FeeRow[] {
  const rows: FeeRow[] = [];
  for (const r of refills) {
    const usd = parseUsd(r.commission);
    if (usd) rows.push({ id: `refill-${r.id}`, kind: "refill", date: r.date, ms: parseInvestingDateMs(r.date), usd, detail: "", depositUsd: parseUsd(r.amount) });
  }
  for (const a of activities) {
    const usd = parseUsd(a.commission_usd ?? a.commission);
    if (!usd) continue;
    rows.push({
      id: `trade-${a.id}`,
      kind: a.type === "sell" ? "sell" : "buy",
      date: a.date,
      ms: parseInvestingDateMs(a.date),
      usd,
      detail: a.name,
      ticker: a.ticker,
      count: a.count,
    });
  }
  for (const f of external) {
    const usd = parseUsd(f.amount);
    if (usd) rows.push({ id: `external-${f.id}`, kind: "external", date: f.date, ms: parseInvestingDateMs(f.date), usd, detail: f.note });
  }
  // The broker charges interest daily, a few cents at a time: one row per month reads better than hundreds.
  const months = new Map<string, { date: string; ms: number; usd: number; days: number }>();
  for (const r of interest) {
    const usd = parseUsd(r.amount);
    const ms = parseInvestingDateMs(r.date);
    if (!usd || ms == null) continue;
    const d = new Date(ms);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const m = months.get(key);
    if (!m) months.set(key, { date: r.date, ms, usd, days: 1 });
    else {
      m.usd += usd;
      m.days += 1;
      if (ms > m.ms) Object.assign(m, { date: r.date, ms });
    }
  }
  for (const [key, m] of months) {
    rows.push({ id: `interest-${key}`, kind: "interest", date: m.date, ms: m.ms, usd: m.usd, detail: "", days: m.days });
  }
  return rows.sort((a, b) => (b.ms ?? -Infinity) - (a.ms ?? -Infinity));
}
