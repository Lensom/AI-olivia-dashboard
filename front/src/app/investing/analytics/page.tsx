"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AnnualReturnsChart,
  ValueVsInvestedChart,
  type AnnualReturnPoint,
  type ValueInvestedPoint,
} from "@/features/investing/charts/performance-charts";
import { YearlyActivityVolumeChart } from "@/features/investing/charts/yearly-activity-volume-chart";
import { formatUsd, parseInvestingDateMs, parseUsd } from "@/features/investing/format";
import { investingTableScrollWrap } from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/state/auth-store";
import { useInvesting } from "@/state/investing-store";

const BENCHMARK = "SPY";
const BENCHMARK_LABEL = "S&P 500 (SPY)";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const th = "px-3 py-2 font-medium";
const td = "px-3 py-2 tabular-nums";

function toneClass(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[#6f675b]";
  return n > 0 ? "text-emerald-700" : "text-rose-700";
}

function signedPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

const fmt0 = (n: number) => formatUsd(n).replace(/\.\d\d$/, "");

/** Geometric mean of yearly % returns, as %/yr. */
function annualized(returns: number[]): number | null {
  if (returns.length === 0) return null;
  const growth = returns.reduce((g, r) => g * (1 + r / 100), 1);
  return (Math.pow(growth, 1 / returns.length) - 1) * 100;
}

type YearRow = {
  year: number;
  label: string;
  deposit: number;
  endValue: number;
  invested: number;
  ret: number | null;
  bench: number | null;
  ytd: boolean;
};

type Fundamentals = Record<string, { beta: number | null; div_yield_percent: number | null }>;

export default function InvestingAnalyticsPage() {
  const { token } = useAuth();
  const { holdings, capitalEntries, refills, activitiesSummary } = useInvesting();
  const [nowYear] = useState(() => new Date().getFullYear());
  const [bench, setBench] = useState<Record<string, number> | null>(null);
  const [fundamentals, setFundamentals] = useState<Fundamentals | null>(null);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ yearly_return_percent: Record<string, number> }>(`/investing/benchmark?symbol=${BENCHMARK}`, { token })
      .then((r) => setBench(r.yearly_return_percent ?? {}))
      .catch(() => setBench({}));
  }, [token]);

  const tickerKey = useMemo(
    () => [...new Set(holdings.map((h) => h.ticker.trim().toUpperCase()).filter(Boolean))].sort().join(","),
    [holdings],
  );
  useEffect(() => {
    if (!token || !tickerKey) return;
    apiFetch<{ fundamentals: Fundamentals }>(`/investing/fundamentals?tickers=${encodeURIComponent(tickerKey)}`, {
      token,
    })
      .then((r) => setFundamentals(r.fundamentals ?? {}))
      .catch(() => setFundamentals({}));
  }, [token, tickerKey]);

  const holdingsValue = useMemo(() => holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0), [holdings]);

  // ---- Performance by year: capital entries (year-end snapshots) + current year to date ----
  const yearRows = useMemo<YearRow[]>(() => {
    const entries = capitalEntries
      .map((e) => ({ e, t: parseInvestingDateMs(e.date) }))
      .filter((x): x is { e: (typeof capitalEntries)[number]; t: number } => x.t != null)
      .sort((a, b) => a.t - b.t);
    const rows: YearRow[] = [];
    for (const { e, t } of entries) {
      const year = new Date(t).getUTCFullYear();
      const deposit = parseUsd(e.deposit);
      const ret = Number.parseFloat(String(e.one_year_percent).replace("%", ""));
      rows.push({
        year,
        label: String(year),
        deposit,
        endValue: parseUsd(e.total_value),
        invested: (rows[rows.length - 1]?.invested ?? 0) + deposit,
        ret: Number.isFinite(ret) ? ret : null,
        bench: bench?.[String(year)] ?? null,
        ytd: false,
      });
    }
    const last = rows[rows.length - 1];
    if (last && last.year < nowYear && holdingsValue > 0) {
      // Same method as the 1Y column: deposits treated as made at the start of the year.
      const deposit = refills
        .filter((r) => {
          const t = parseInvestingDateMs(r.date);
          return t != null && new Date(t).getUTCFullYear() === nowYear;
        })
        .reduce((a, r) => a + parseUsd(r.amount), 0);
      const base = last.endValue + deposit;
      rows.push({
        year: nowYear,
        label: `${nowYear} YTD`,
        deposit,
        endValue: holdingsValue,
        invested: last.invested + deposit,
        ret: base > 0 ? ((holdingsValue - base) / base) * 100 : null,
        bench: bench?.[String(nowYear)] ?? null,
        ytd: true,
      });
    }
    return rows;
  }, [capitalEntries, refills, holdingsValue, bench, nowYear]);

  // A first year that started after January can't be compared with the index's full calendar year.
  const firstYearPartial = useMemo(() => {
    const first = Math.min(...refills.map((r) => parseInvestingDateMs(r.date) ?? Infinity));
    return Number.isFinite(first) && new Date(first).getUTCMonth() > 0 ? new Date(first).getUTCFullYear() : null;
  }, [refills]);

  const kpis = useMemo(() => {
    const full = yearRows.filter((r) => !r.ytd && r.ret != null && r.year !== firstYearPartial);
    const paired = full.filter((r) => r.bench != null);
    const you = annualized(paired.map((r) => r.ret!));
    const them = annualized(paired.map((r) => r.bench!));
    const best = [...full].sort((a, b) => b.ret! - a.ret!)[0];
    const worst = [...full].sort((a, b) => a.ret! - b.ret!)[0];
    return {
      you,
      them,
      years: paired.length,
      beat: paired.filter((r) => r.ret! > r.bench!).length,
      best,
      worst,
      span: paired.length ? `${paired[0]!.year}–${paired[paired.length - 1]!.year}` : "",
    };
  }, [yearRows, firstYearPartial]);

  const returnsChart = useMemo<AnnualReturnPoint[]>(
    () => yearRows.map((r) => ({ label: r.ytd ? `${r.year}*` : r.label, you: r.ret, benchmark: r.bench })),
    [yearRows],
  );
  const valueChart = useMemo<ValueInvestedPoint[]>(
    () => yearRows.map((r) => ({ label: r.ytd ? "Now" : r.label, value: r.endValue, invested: r.invested })),
    [yearRows],
  );

  // ---- Risk & income by holding ----
  const riskRows = useMemo(() => {
    const total = holdingsValue || 1;
    const rows = holdings
      .filter((h) => h.ticker.trim() && parseUsd(h.marketValue) > 0)
      .map((h) => {
        const t = h.ticker.trim().toUpperCase();
        const value = parseUsd(h.marketValue);
        const weight = value / total;
        const f = fundamentals?.[t];
        const beta = f?.beta ?? null;
        const yieldPct = f?.div_yield_percent ?? null;
        return {
          ticker: t,
          name: h.name,
          value,
          weight: weight * 100,
          beta,
          betaContribution: beta == null ? null : weight * beta,
          yieldPct,
          income: yieldPct == null ? null : (value * yieldPct) / 100,
        };
      })
      .sort((a, b) => b.value - a.value);
    const covered = rows.filter((r) => r.beta != null);
    const coveredWeight = covered.reduce((a, r) => a + r.weight, 0) / 100;
    const portfolioBeta = coveredWeight > 0 ? covered.reduce((a, r) => a + r.betaContribution!, 0) / coveredWeight : null;
    const income = rows.reduce((a, r) => a + (r.income ?? 0), 0);
    return { rows, portfolioBeta, income, yieldPct: holdingsValue > 0 ? (income / holdingsValue) * 100 : 0 };
  }, [holdings, fundamentals, holdingsValue]);

  // ---- Trading by year ----
  const tradingRows = useMemo(
    () =>
      activitiesSummary
        .map((s) => {
          const bought = parseUsd(s.purchases_amount);
          const sold = parseUsd(s.sales_amount);
          const fees = parseUsd(s.purchases_commission) + parseUsd(s.sales_commission);
          return {
            year: Number.parseInt(s.year, 10),
            bought,
            sold,
            realized: parseUsd(s.sales_pnl),
            fees,
            feePct: bought + sold > 0 ? (fees / (bought + sold)) * 100 : 0,
          };
        })
        .filter((r) => Number.isFinite(r.year))
        .sort((a, b) => a.year - b.year),
    [activitiesSummary],
  );
  const tradingTotals = useMemo(
    () =>
      tradingRows.reduce(
        (a, r) => ({ bought: a.bought + r.bought, sold: a.sold + r.sold, realized: a.realized + r.realized, fees: a.fees + r.fees }),
        { bought: 0, sold: 0, realized: 0, fees: 0 },
      ),
    [tradingRows],
  );

  const hasHistory = yearRows.length > 0;

  return (
    <div className="space-y-5">
      <p className="text-sm text-[#655d51]">
        How the portfolio has performed over the years against the market, where its risk and income come from, and
        what trading has cost. Current allocation and today&apos;s moves are on{" "}
        <Link href="/investing/dashboard" className="font-medium text-[#3b352d] underline decoration-black/15 underline-offset-2">
          Overview
        </Link>
        .
      </p>

      {/* Headline performance */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className={card}>
          <p className="text-xs text-[#7f7668]">Average annual return</p>
          <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneClass(kpis.you)}`}>{signedPct(kpis.you)}</p>
          <p className="mt-1 text-xs text-[#6f675b]">
            {BENCHMARK_LABEL} {bench == null ? "…" : signedPct(kpis.them)} over the same years ({kpis.span})
          </p>
        </article>
        <article className={card}>
          <p className="text-xs text-[#7f7668]">vs {BENCHMARK_LABEL}</p>
          <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneClass(kpis.you != null && kpis.them != null ? kpis.you - kpis.them : null)}`}>
            {kpis.you != null && kpis.them != null ? `${signedPct(kpis.you - kpis.them)} / yr` : "—"}
          </p>
          <p className="mt-1 text-xs text-[#6f675b]">
            Beat the index in {kpis.beat} of {kpis.years} years
          </p>
        </article>
        <article className={card}>
          <p className="text-xs text-[#7f7668]">Best year</p>
          <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneClass(kpis.best?.ret)}`}>
            {kpis.best ? signedPct(kpis.best.ret) : "—"}
          </p>
          <p className="mt-1 text-xs text-[#6f675b]">
            {kpis.best ? `${kpis.best.year} · index ${signedPct(kpis.best.bench)}` : "No history yet"}
          </p>
        </article>
        <article className={card}>
          <p className="text-xs text-[#7f7668]">Worst year</p>
          <p className={`mt-1.5 text-xl font-semibold tabular-nums ${toneClass(kpis.worst?.ret)}`}>
            {kpis.worst ? signedPct(kpis.worst.ret) : "—"}
          </p>
          <p className="mt-1 text-xs text-[#6f675b]">
            {kpis.worst ? `${kpis.worst.year} · index ${signedPct(kpis.worst.bench)}` : "No history yet"}
          </p>
        </article>
      </section>

      {hasHistory ? (
        <>
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <article className={card}>
              <h2 className="text-sm font-semibold text-[#1f1c17]">Annual return vs the market</h2>
              <p className="mb-3 mt-0.5 text-xs text-[#8f8676]">
                Your return each year next to {BENCHMARK_LABEL} with dividends reinvested.
              </p>
              <AnnualReturnsChart data={returnsChart} benchmarkLabel={BENCHMARK_LABEL} />
            </article>
            <article className={card}>
              <h2 className="text-sm font-semibold text-[#1f1c17]">Value vs money invested</h2>
              <p className="mb-3 mt-0.5 text-xs text-[#8f8676]">
                Year-end value against everything you&apos;ve put in. The gap between the lines is your gain.
              </p>
              <ValueVsInvestedChart data={valueChart} />
            </article>
          </section>

          <article className={card}>
            <h2 className="text-sm font-semibold text-[#1f1c17]">Year by year</h2>
            <div className={`${investingTableScrollWrap} mt-3`}>
              <table className="w-full min-w-[680px] border-collapse text-left text-sm">
                <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                  <tr>
                    <th className={th}>Year</th>
                    <th className={`${th} text-right`}>Deposited</th>
                    <th className={`${th} text-right`}>Total invested</th>
                    <th className={`${th} text-right`}>Year-end value</th>
                    <th className={`${th} text-right`}>Your return</th>
                    <th className={`${th} text-right`}>{BENCHMARK_LABEL}</th>
                    <th className={`${th} text-right`}>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {yearRows.map((r) => {
                    const diff = r.ret != null && r.bench != null ? r.ret - r.bench : null;
                    return (
                      <tr key={r.label} className="border-t border-black/5">
                        <td className="px-3 py-2 font-medium text-[#1f1c17]">{r.label}</td>
                        <td className={`${td} text-right text-[#3b352d]`}>{fmt0(r.deposit)}</td>
                        <td className={`${td} text-right text-[#3b352d]`}>{fmt0(r.invested)}</td>
                        <td className={`${td} text-right text-[#3b352d]`}>{fmt0(r.endValue)}</td>
                        <td className={`${td} text-right font-medium ${toneClass(r.ret)}`}>{signedPct(r.ret)}</td>
                        <td className={`${td} text-right ${toneClass(r.bench)}`}>{bench == null ? "…" : signedPct(r.bench)}</td>
                        <td className={`${td} text-right font-medium ${toneClass(diff)}`}>
                          {diff == null ? "—" : `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(1)} pp`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-[#8f8676]">
              Your return per year treats that year&apos;s deposits as made on Jan 1 (same as the 1Y column in Capital
              entries on Overview).{" "}
              {firstYearPartial
                ? `${firstYearPartial} is a partial year (you started mid-year), so the cards above leave it out. `
                : ""}
              * Year to date uses current holdings value, so uninvested cash is not counted.
            </p>
          </article>
        </>
      ) : (
        <article className={`${card} text-sm text-[#655d51]`}>
          Add year-end rows in Capital entries on{" "}
          <Link href="/investing/dashboard" className="underline">
            Overview
          </Link>{" "}
          to see performance over time.
        </article>
      )}

      {/* Risk & income */}
      <article className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#1f1c17]">Risk & income by holding</h2>
            <p className="mt-0.5 text-xs text-[#8f8676]">
              Beta: how much a holding moves with the market (1.0 = same as the market). Contribution = weight × beta,
              and the contributions add up to the portfolio&apos;s beta.
            </p>
          </div>
          <p className="text-xs text-[#6f675b]">
            Portfolio beta{" "}
            <span className="font-semibold text-[#1f1c17]">
              {riskRows.portfolioBeta == null ? "…" : riskRows.portfolioBeta.toFixed(2)}
            </span>
            {" · "}Dividends{" "}
            <span className="font-semibold text-[#1f1c17]">
              {fundamentals == null ? "…" : `${formatUsd(riskRows.income)}/yr (${riskRows.yieldPct.toFixed(2)}%)`}
            </span>
          </p>
        </div>
        <div className={`${investingTableScrollWrap} mt-3`}>
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
              <tr>
                <th className={th}>Holding</th>
                <th className={`${th} text-right`}>Weight</th>
                <th className={`${th} text-right`}>Beta</th>
                <th className={`${th} text-right`}>Beta contribution</th>
                <th className={`${th} text-right`}>Div. yield</th>
                <th className={`${th} text-right`}>Income / yr</th>
                <th className={`${th} text-right`}>Share of income</th>
              </tr>
            </thead>
            <tbody>
              {riskRows.rows.map((r) => (
                <tr key={r.ticker} className="border-t border-black/5">
                  <td className="px-3 py-2">
                    <span className="font-semibold text-[#1f1c17]">{r.ticker}</span>{" "}
                    <span className="text-xs text-[#8f8676]">{r.name !== r.ticker ? r.name : ""}</span>
                  </td>
                  <td className={`${td} text-right text-[#3b352d]`}>{r.weight.toFixed(1)}%</td>
                  <td
                    className={`${td} text-right ${r.beta != null && r.beta >= 1.5 ? "font-semibold text-amber-700" : "text-[#3b352d]"}`}
                    title={r.beta != null && r.beta >= 1.5 ? "High beta: swings ~1.5× the market or more" : undefined}
                  >
                    {fundamentals == null ? "…" : r.beta == null ? "—" : r.beta.toFixed(2)}
                  </td>
                  <td className={`${td} text-right text-[#3b352d]`}>
                    {r.betaContribution == null ? "—" : r.betaContribution.toFixed(3)}
                  </td>
                  <td className={`${td} text-right text-[#3b352d]`}>
                    {fundamentals == null ? "…" : r.yieldPct == null ? "—" : `${r.yieldPct.toFixed(2)}%`}
                  </td>
                  <td className={`${td} text-right text-[#3b352d]`}>{r.income == null ? "—" : formatUsd(r.income)}</td>
                  <td className={`${td} text-right text-[#3b352d]`}>
                    {r.income == null || riskRows.income <= 0 ? "—" : `${((r.income / riskRows.income) * 100).toFixed(0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-[#8f8676]">
          Beta and trailing 12-month yield from Finviz. Income is an estimate: value × yield. Beta ≥ 1.5 is highlighted.
        </p>
      </article>

      {/* Trading */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <YearlyActivityVolumeChart data={tradingRows.map((r) => ({ year: r.year, purchases: r.bought, sales: r.sold }))} />
        <article className={card}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">Trading results by year</h2>
          <p className="mt-0.5 text-xs text-[#8f8676]">
            Profit locked in by selling, and what trades cost. From{" "}
            <Link href="/investing/activities" className="underline decoration-black/15 underline-offset-2">
              Activities
            </Link>
            .
          </p>
          <div className={`${investingTableScrollWrap} mt-3`}>
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className={th}>Year</th>
                  <th className={`${th} text-right`}>Bought</th>
                  <th className={`${th} text-right`}>Sold</th>
                  <th className={`${th} text-right`}>Realized P&L</th>
                  <th className={`${th} text-right`}>Fees</th>
                  <th className={`${th} text-right`}>Fees % of volume</th>
                </tr>
              </thead>
              <tbody>
                {tradingRows.map((r) => (
                  <tr key={r.year} className="border-t border-black/5">
                    <td className="px-3 py-2 font-medium text-[#1f1c17]">{r.year}</td>
                    <td className={`${td} text-right text-[#3b352d]`}>{fmt0(r.bought)}</td>
                    <td className={`${td} text-right text-[#3b352d]`}>{fmt0(r.sold)}</td>
                    <td className={`${td} text-right font-medium ${toneClass(r.realized)}`}>
                      {r.realized > 0 ? "+" : ""}
                      {formatUsd(r.realized)}
                    </td>
                    <td className={`${td} text-right text-[#3b352d]`}>{formatUsd(r.fees)}</td>
                    <td className={`${td} text-right text-[#3b352d]`}>{r.feePct.toFixed(2)}%</td>
                  </tr>
                ))}
                {tradingRows.length > 0 ? (
                  <tr className="border-t-2 border-black/15 bg-[#f6f3ea] font-semibold">
                    <td className="px-3 py-2 text-[#1f1c17]">Total</td>
                    <td className={`${td} text-right`}>{fmt0(tradingTotals.bought)}</td>
                    <td className={`${td} text-right`}>{fmt0(tradingTotals.sold)}</td>
                    <td className={`${td} text-right ${toneClass(tradingTotals.realized)}`}>
                      {tradingTotals.realized > 0 ? "+" : ""}
                      {formatUsd(tradingTotals.realized)}
                    </td>
                    <td className={`${td} text-right`}>{formatUsd(tradingTotals.fees)}</td>
                    <td className={`${td} text-right`}>
                      {tradingTotals.bought + tradingTotals.sold > 0
                        ? `${((tradingTotals.fees / (tradingTotals.bought + tradingTotals.sold)) * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
