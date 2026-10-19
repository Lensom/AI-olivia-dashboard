import { formatUsd, parsePercent, parseUsd } from "@/features/investing/format";
import type { InvestingHolding } from "@/features/investing/types";
import type { AttentionRules } from "@/state/broker-store";
import type { T } from "@/lib/i18n";
import type { InvestingPickingRow } from "@/state/investing-store";

export type AttentionKind = "warn" | "opportunity" | "todo";
export type AttentionItem = { id: string; kind: AttentionKind; title: string; detail?: string; href: string };

export type AttentionInput = {
  rules: AttentionRules;
  holdings: InvestingHolding[];
  pickingRows: InvestingPickingRow[];
  cashUsd: number;
  hasCashEntry: boolean;
  hasDividends: boolean;
  /** All fees as % of deposits (null when nothing deposited). */
  feesPct: number | null;
  /** Money-weighted annual return, % (null when not computable). */
  xirrPct: number | null;
  /** Total page: null when it hasn't been saved yet. */
  total: {
    goals: Record<string, number>;
    /** Share of assets per group, %, from live values. */
    mix: Record<string, number> | null;
    monthRecorded: boolean;
    monthLabel: string;
  } | null;
};

const num = (s: string | undefined) => {
  const raw = String(s ?? "").trim();
  return raw && /\d/.test(raw) ? parseUsd(raw) : NaN;
};

/** Every check that's currently failing, most important first: rule breaks, then opportunities, then to-dos. */
export function attentionItems(x: AttentionInput, t: T): AttentionItem[] {
  const out: AttentionItem[] = [];
  const r = x.rules;
  const holdingsValue = x.holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);

  if (x.feesPct != null && x.feesPct > r.max_fees_pct) {
    out.push({
      id: "fees",
      kind: "warn",
      title: t("Fees are {v}% of deposits — your limit is {max}%", { v: x.feesPct.toFixed(2), max: r.max_fees_pct }),
      detail: t("Refill, buy and sell commissions together."),
      href: "/investing/finance",
    });
  }

  if (x.xirrPct != null && x.xirrPct < r.min_annual_return_pct) {
    out.push({
      id: "return",
      kind: "warn",
      title: t("Annualized return is {v}% — below your {min}% minimum", { v: x.xirrPct.toFixed(1), min: r.min_annual_return_pct }),
      href: "/investing/finance",
    });
  }

  if (holdingsValue > 0) {
    const etf = x.holdings
      .filter((h) => (h.industry ?? "").trim().toUpperCase().startsWith("ETF"))
      .reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const etfPct = (etf / holdingsValue) * 100;
    if (etfPct < r.etf_min_pct || etfPct > r.etf_max_pct) {
      out.push({
        id: "etf",
        kind: "warn",
        title: t("ETF share is {v}% — your range is {min}–{max}%", { v: etfPct.toFixed(1), min: r.etf_min_pct, max: r.etf_max_pct }),
        href: "/investing/holdings",
      });
    }

    const largest = [...x.holdings].sort((a, b) => parseUsd(b.marketValue) - parseUsd(a.marketValue))[0];
    const largestPct = largest ? (parseUsd(largest.marketValue) / holdingsValue) * 100 : 0;
    if (largest && largestPct > r.max_position_pct) {
      out.push({
        id: "position",
        kind: "warn",
        title: t("{ticker} is {v}% of the portfolio — above your {max}% cap", { ticker: largest.ticker, v: largestPct.toFixed(1), max: r.max_position_pct }),
        href: "/investing/dashboard",
      });
    }
  }

  const withTargets = x.holdings.filter((h) => parsePercent(h.targetWeight ?? "") > 0);
  const targetSum = withTargets.reduce((a, h) => a + parsePercent(h.targetWeight), 0);
  if (withTargets.length && Math.abs(targetSum - 100) > 0.5) {
    out.push({
      id: "targets",
      kind: "warn",
      title: t("Targets add up to {v}%, not 100%", { v: targetSum.toFixed(1) }),
      detail: t("Rebalance suggestions are off until they do."),
      href: "/investing/holdings",
    });
  }
  const drifted = withTargets
    .map((h) => ({ t: h.ticker, d: parsePercent(h.currentWeight) - parsePercent(h.targetWeight) }))
    .filter((h) => Math.abs(h.d) >= r.drift_pp)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  if (drifted.length) {
    out.push({
      id: "drift",
      kind: "warn",
      title: t("{n} holdings off target by ≥ {pp} pp", { n: drifted.length, pp: r.drift_pp }),
      detail: drifted
        .slice(0, 4)
        .map((h) => `${h.t} ${h.d > 0 ? "+" : ""}${h.d.toFixed(1)}`)
        .join(" · "),
      href: "/investing/dashboard",
    });
  }

  if (x.total?.mix) {
    for (const [key, label] of [["stocks", "Stocks"], ["savings", "Savings"], ["crypto", "Crypto"]] as const) {
      const goal = x.total.goals[key] ?? 0;
      const now = x.total.mix[key] ?? 0;
      if (Math.abs(now - goal) >= r.drift_pp) {
        out.push({
          id: `mix-${key}`,
          kind: "warn",
          title: t(now < goal ? "{group} is {v}% of your net worth — {pp} pp under its {goal}% goal" : "{group} is {v}% of your net worth — {pp} pp over its {goal}% goal", {
            group: t(label),
            v: now.toFixed(1),
            pp: Math.abs(now - goal).toFixed(1),
            goal,
          }),
          href: "/investing/total",
        });
      }
    }
  }

  const accountValue = holdingsValue + x.cashUsd;
  if (accountValue > 0 && (x.cashUsd / accountValue) * 100 > r.max_cash_pct) {
    out.push({
      id: "cash",
      kind: "opportunity",
      title: t("{v} is sitting uninvested ({pct}% of the account)", { v: formatUsd(x.cashUsd), pct: ((x.cashUsd / accountValue) * 100).toFixed(1) }),
      detail: t("More than your {max}% cash limit — time to buy?", { max: r.max_cash_pct }),
      href: "/investing/picking",
    });
  }

  for (const p of x.pickingRows) {
    const px = num(p.current_price);
    const strong = num(p.strong_buy_until);
    const may = num(p.may_buy_until);
    if (!Number.isFinite(px) || !p.ticker.trim()) continue;
    if (Number.isFinite(strong) && px <= strong) {
      out.push({
        id: `zone-${p.id}`,
        kind: "opportunity",
        title: t("{ticker} is in your strong-buy zone", { ticker: p.ticker }),
        detail: `${formatUsd(px)} ≤ ${formatUsd(strong)}`,
        href: "/investing/picking",
      });
    } else if (Number.isFinite(may) && px <= may) {
      out.push({
        id: `zone-${p.id}`,
        kind: "opportunity",
        title: t("{ticker} is in your may-buy zone", { ticker: p.ticker }),
        detail: `${formatUsd(px)} ≤ ${formatUsd(may)}`,
        href: "/investing/picking",
      });
    }
  }

  if (x.total == null) {
    out.push({ id: "total-setup", kind: "todo", title: t("Save your Total page to start tracking net worth"), href: "/investing/total" });
  } else if (!x.total.monthRecorded) {
    out.push({ id: "total-month", kind: "todo", title: t("Record {month} on Total", { month: x.total.monthLabel }), href: "/investing/total" });
  }
  if (!x.hasCashEntry) {
    out.push({
      id: "cash-setup",
      kind: "todo",
      title: t("Enter your broker cash balance"),
      detail: t("Until then, returns ignore uninvested cash."),
      href: "/investing/finance",
    });
  }
  if (!x.hasDividends) {
    out.push({ id: "dividends-setup", kind: "todo", title: t("Record dividends you've received"), href: "/investing/finance" });
  }

  const order: Record<AttentionKind, number> = { warn: 0, opportunity: 1, todo: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
