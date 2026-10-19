"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { YearlyInvestmentsBarChart } from "@/features/investing/charts/yearly-investments-bar-chart";
import { formatUsd, parseInvestingDateMs, parseUsd } from "@/features/investing/format";
import {
  currentYearPace,
  depositsVsBuys,
  feeBreakdown,
  refillsByYear,
  xirrFromRefills,
} from "@/features/investing/funding-stats";
import {
  investingMetaBadge,
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingSubsectionStack,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { InvestingSubsectionHeader } from "@/features/investing/ui/investing-subsection-header";
import { BrokerCashAndDividends } from "@/features/investing/broker-section";
import { useBroker } from "@/state/broker-store";
import { useLocale, useT } from "@/lib/i18n";
import { useInvesting } from "@/state/investing-store";

function inputBaseClasses() {
  return "w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20 focus:bg-white";
}

function parseRefillYear(dateStr: string): number | null {
  const s = dateStr.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-\d{2}-\d{2}/);
  if (iso) return parseInt(iso[1]!, 10);
  const eu = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (eu) return parseInt(eu[3]!, 10);
  const tail = s.match(/(\d{4})$/);
  if (tail) return parseInt(tail[1]!, 10);
  return null;
}

function yearlyInvestFromRefills(
  rows: { date: string; amount: string }[],
): { year: number; value: number }[] {
  const byYear = new Map<number, number>();
  for (const r of rows) {
    const y = parseRefillYear(r.date);
    if (y === null) continue;
    byYear.set(y, (byYear.get(y) ?? 0) + parseUsd(r.amount));
  }
  if (byYear.size === 0) return [];
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const from = years[0]!;
  const to = years[years.length - 1]!;
  const out: { year: number; value: number }[] = [];
  for (let y = from; y <= to; y++) {
    out.push({ year: y, value: byYear.get(y) ?? 0 });
  }
  return out;
}

function toneClass(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-[#1f1c17]";
}

function signedPct(n: number, digits = 1): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  const t = useT();
  return (
    <article className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
      <p className="text-xs text-[#7f7668]">{t(label)}</p>
      <p className={`mt-1.5 text-lg font-semibold tabular-nums ${tone ?? "text-[#1f1c17]"}`}>{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-[#8f8676]">{t(hint)}</p> : null}
    </article>
  );
}

export default function InvestingFinancePage() {
  const {
    refills,
    operatingExpensesUsd,
    refillsMeta,
    isRefillsLoading,
    isRefillsSaving,
    isRefillsDirty,
    holdings,
    activitiesSummary,
    updateRefill,
    addRefill,
    deleteRefill,
    setOperatingExpensesUsd,
    saveRefills,
    refreshRefills,
  } = useInvesting();
  const { cashUsd } = useBroker();
  const tr = useT();
  const locale = useLocale();

  const holdingsValue = useMemo(() => holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0), [holdings]);
  // Broker cash belongs to the account's value; dividends paid land in it, so they aren't added again.
  const currentValue = holdingsValue + cashUsd;

  const totalInvested = useMemo(() => refills.reduce((a, r) => a + parseUsd(r.amount), 0), [refills]);

  // All fees: refill commissions + buy and sell commissions from Activities, unless overridden manually.
  const fees = useMemo(
    () => feeBreakdown(refills, activitiesSummary, operatingExpensesUsd),
    [refills, activitiesSummary, operatingExpensesUsd],
  );
  const operatingExpenses = fees.total;

  const netAfterFees = totalInvested - operatingExpenses;
  const gainOnGrossPct = totalInvested > 0 ? ((currentValue - totalInvested) / totalInvested) * 100 : 0;
  const gainOnNetPct = netAfterFees > 0 ? ((currentValue - netAfterFees) / netAfterFees) * 100 : 0;

  const yearlyBars = useMemo(() => yearlyInvestFromRefills(refills), [refills]);

  const yearlyTable = useMemo(() => refillsByYear(refills), [refills]);
  const flowRows = useMemo(() => depositsVsBuys(yearlyTable, activitiesSummary), [yearlyTable, activitiesSummary]);
  // Captured once per mount: render must stay pure, and day-level precision is enough here.
  const [nowMs] = useState(() => Date.now());
  const xirr = useMemo(() => xirrFromRefills(refills, currentValue, nowMs), [refills, currentValue, nowMs]);
  const pace = useMemo(() => currentYearPace(refills, nowMs), [refills, nowMs]);
  const netGain = currentValue - totalInvested;
  const feesPct = totalInvested > 0 ? (operatingExpenses / totalInvested) * 100 : 0;
  const daysSinceLastRefill =
    pace.lastRefillMs == null ? null : Math.floor((nowMs - pace.lastRefillMs) / (24 * 60 * 60 * 1000));
  const ytdVsLastPct = pace.lastYearYtd > 0 ? ((pace.ytd - pace.lastYearYtd) / pace.lastYearYtd) * 100 : null;

  const [refillYearFilter, setRefillYearFilter] = useState<number | "all">("all");
  const refillRowsView = useMemo(() => {
    // Running total in chronological order; rows keep their original table order.
    const chrono = refills
      .map((r) => ({ id: r.id, t: parseInvestingDateMs(r.date), amount: parseUsd(r.amount) }))
      .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity));
    const cumulativeById = new Map<string, number>();
    let run = 0;
    for (const r of chrono) {
      run += r.amount;
      cumulativeById.set(r.id, run);
    }
    return refills
      .map((row) => {
        const t = parseInvestingDateMs(row.date);
        return {
          row,
          year: t == null ? null : new Date(t).getUTCFullYear(),
          cumulative: cumulativeById.get(row.id) ?? 0,
        };
      })
      // Undated rows (e.g. a just-added refill) stay visible under every filter.
      .filter((r) => refillYearFilter === "all" || r.year === refillYearFilter || r.year == null);
  }, [refills, refillYearFilter]);
  const filteredTotals = useMemo(
    () =>
      refillRowsView.reduce(
        (a, r) => ({
          invest: a.invest + parseUsd(r.row.amount),
          commission: a.commission + parseUsd(r.row.commission),
        }),
        { invest: 0, commission: 0 },
      ),
    [refillRowsView],
  );


  const [isYearlyOpen, setYearlyOpen] = useState(true);
  const [isRefillsOpen, setRefillsOpen] = useState(true);

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        {tr("Account refills (deposits), commissions, and performance vs. current portfolio value. Purchases and sales:")}{" "}
        <Link
          href="/investing/activities"
          className="font-medium text-[#3b352d] underline decoration-black/15 underline-offset-2 hover:text-[#1f1c17]"
        >
          {tr("Activities")}
        </Link>
        .
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className={investingMetaBadge}>
          {refillsMeta.updatedAt ? tr("Synced {when}", { when: new Date(refillsMeta.updatedAt).toLocaleString(locale) }) : tr("Not synced")}
        </span>
        <button
          type="button"
          onClick={() => void refreshRefills()}
          disabled={isRefillsLoading}
          className={`${investingToolbarBtn} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {isRefillsLoading ? tr("Loading…") : tr("Reload")}
        </button>
        <button type="button" onClick={addRefill} className={investingToolbarBtn}>
          {tr("Add refill")}
        </button>
        <button
          type="button"
          onClick={() => void saveRefills()}
          disabled={!isRefillsDirty || isRefillsSaving || isRefillsLoading}
          className={[
            "transition",
            !isRefillsDirty || isRefillsSaving || isRefillsLoading
              ? investingPrimarySaveDisabled
              : investingPrimarySaveActive,
          ].join(" ")}
        >
          {isRefillsSaving ? tr("Saving…") : tr("Save")}
        </button>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Operating expenses, $"
          value={formatUsd(operatingExpenses)}
          hint={
            fees.isOverride
              ? tr("Manual override is active (calculated: {v}).", { v: formatUsd(fees.computed) })
              : tr("Refills {r} · Buys {b} · Sells {s}", { r: formatUsd(fees.refill), b: formatUsd(fees.buy), s: formatUsd(fees.sell) })
          }
        />
        <StatCard
          label="Current value"
          value={formatUsd(currentValue)}
          hint={
            cashUsd > 0
              ? tr("Holdings {h} + broker cash {c}", { h: formatUsd(holdingsValue), c: formatUsd(cashUsd) })
              : "Live from holdings quotes (no broker cash entered)."
          }
        />
        <StatCard label="Total topped" value={formatUsd(totalInvested)} hint="Sum of Invest column." />
        <StatCard
          label="Topped − fee"
          value={formatUsd(netAfterFees)}
          hint="Total topped minus operating expenses."
        />
        <StatCard
          label="Total %"
          value={`${gainOnGrossPct.toFixed(2)}%`}
          hint="(Current − topped) / topped."
        />
        <StatCard
          label="Total, − fee %"
          value={`${gainOnNetPct.toFixed(2)}%`}
          hint="(Current − net after fees) / net after fees."
        />
        <StatCard
          label="Net gain, $"
          value={`${netGain > 0 ? "+" : ""}${formatUsd(netGain)}`}
          tone={toneClass(netGain)}
          hint="Current value − total topped."
        />
        <StatCard
          label="Annualized return (XIRR)"
          value={xirr == null ? "—" : signedPct(xirr * 100, 2)}
          tone={xirr == null ? undefined : toneClass(xirr)}
          hint="Money-weighted: accounts for when each refill was made."
        />
        <StatCard label="Fees, % of topped" value={`${feesPct.toFixed(2)}%`} hint="Operating expenses / total topped." />
      </section>

      <section className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-2xl border border-black/5 bg-white/90 px-5 py-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <p className="w-full text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676] sm:w-auto">
          {tr("{year} pace", { year: pace.year })}
        </p>
        <div>
          <p className="text-[11px] text-[#8f8676]">{tr("Topped YTD")}</p>
          <p className="text-base font-semibold tabular-nums text-[#1f1c17]">{formatUsd(pace.ytd)}</p>
          <p className="text-[11px] text-[#8f8676]">
            {tr("{n} refills", { n: pace.count })}
            {ytdVsLastPct == null ? null : (
              <>
                {" · "}
                <span className={toneClass(ytdVsLastPct)}>{signedPct(ytdVsLastPct, 0)}</span>{" "}
                {tr("vs same period {year}", { year: pace.year - 1 })}
              </>
            )}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-[#8f8676]">{tr("Avg per month")}</p>
          <p className="text-base font-semibold tabular-nums text-[#1f1c17]">{formatUsd(pace.avgPerMonth)}</p>
          <p className="text-[11px] text-[#8f8676]">{tr("This year so far")}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#8f8676]">{tr("Projected {year}", { year: pace.year })}</p>
          <p className="text-base font-semibold tabular-nums text-[#1f1c17]">{formatUsd(pace.projected)}</p>
          <p className="text-[11px] text-[#8f8676]">{tr("At the current pace")}</p>
        </div>
        <div>
          <p className="text-[11px] text-[#8f8676]">{tr("Last refill")}</p>
          <p className="text-base font-semibold tabular-nums text-[#1f1c17]">
            {daysSinceLastRefill == null
              ? "—"
              : daysSinceLastRefill === 0
                ? tr("Today")
                : tr("{n} days ago", { n: daysSinceLastRefill })}
          </p>
          <p className="text-[11px] text-[#8f8676]">
            {pace.lastRefillMs == null ? "" : new Date(pace.lastRefillMs).toLocaleDateString(locale)}
          </p>
        </div>
      </section>

      <BrokerCashAndDividends holdingsValue={holdingsValue} />

      <section className={investingSubsectionStack}>
        <InvestingSubsectionHeader
          title="Yearly overview"
          isOpen={isYearlyOpen}
          onToggle={() => setYearlyOpen((v) => !v)}
        />
        {isYearlyOpen ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <article className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
              <h3 className="text-sm font-semibold text-[#1f1c17]">{tr("Yearly summary")}</h3>
              <p className="mt-1 text-xs text-[#655d51]">{tr("Invest amounts aggregated by calendar year.")}</p>
              <div className={`${investingTableScrollWrap} mt-4`}>
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                    <tr>
                      <th className="px-3 py-2 font-medium">{tr("Year")}</th>
                      <th className="px-3 py-2 font-medium">{tr("Sum of invest")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Refills")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Commission")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Cumulative")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("YoY")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearlyTable.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-4 text-center text-xs text-[#8f8676]">
                          {tr("No dated refills yet.")}
                        </td>
                      </tr>
                    ) : (
                      yearlyTable.map((row) => (
                        <tr key={row.year} className="border-t border-black/5">
                          <td className="px-3 py-2 font-medium text-[#1f1c17]">{row.year}</td>
                          <td className="px-3 py-2 tabular-nums text-[#3b352d]">
                            {row.sum.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#3b352d]">{row.count}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#3b352d]">{fmt2(row.commission)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-[#3b352d]">{fmt2(row.cumulative)}</td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${row.yoyPct == null ? "text-[#8f8676]" : toneClass(row.yoyPct)}`}
                          >
                            {row.yoyPct == null ? "—" : signedPct(row.yoyPct, 0)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 rounded-xl border border-black/5 bg-[#faf8f2] p-3">
                <label className="block text-xs font-medium text-[#6f675b]">{tr("Operating expenses override, $")}</label>
                <p className="mt-0.5 text-[11px] text-[#8f8676]">
                  {tr("Leave empty to use all fees: refill commissions plus buy and sell commissions from Activities. Set a total only to match another source (e.g. a broker statement).")}
                </p>
                <input
                  value={operatingExpensesUsd}
                  onChange={(e) => setOperatingExpensesUsd(e.target.value)}
                  placeholder={tr("Leave empty to use {v} (refills + buys + sells)", { v: fees.computed.toFixed(2) })}
                  className={`${inputBaseClasses()} mt-2`}
                />
              </div>
            </article>
            <YearlyInvestmentsBarChart
              title="Amount of investments by year"
              data={yearlyBars}
              yAxisLabel="Sum of invest"
              xAxisLabel="Year"
            />
            <article className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)] lg:col-span-2">
              <h3 className="text-sm font-semibold text-[#1f1c17]">{tr("Deposits vs buys")}</h3>
              <p className="mt-1 text-xs text-[#655d51]">
                {tr("Where topped-up money went each year (buys and sales from Activities, in USD). Unspent = running topped − bought + sold − trade fees: cash not yet in positions.")}
              </p>
              <div className={`${investingTableScrollWrap} mt-4`}>
                <table className="w-full min-w-[640px] border-collapse text-left text-sm tabular-nums">
                  <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                    <tr>
                      <th className="px-3 py-2 font-medium">{tr("Year")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Topped")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Bought")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Sold")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Trade fees")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Net cash")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Unspent (est.)")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-4 text-center text-xs text-[#8f8676]">
                          {tr("No refills or activities yet.")}
                        </td>
                      </tr>
                    ) : (
                      flowRows.map((r) => (
                        <tr key={r.year} className="border-t border-black/5">
                          <td className="px-3 py-2 font-medium text-[#1f1c17]">{r.year}</td>
                          <td className="px-3 py-2 text-right text-[#3b352d]">{fmt2(r.deposited)}</td>
                          <td className="px-3 py-2 text-right text-[#3b352d]">{fmt2(r.bought)}</td>
                          <td className="px-3 py-2 text-right text-[#3b352d]">{fmt2(r.sold)}</td>
                          <td className="px-3 py-2 text-right text-[#3b352d]">{fmt2(r.fees)}</td>
                          <td className={`px-3 py-2 text-right ${toneClass(r.netCash)}`}>
                            {r.netCash > 0 ? "+" : ""}
                            {fmt2(r.netCash)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-medium ${r.unspent < 0 ? "text-rose-700" : "text-[#1f1c17]"}`}
                          >
                            {fmt2(r.unspent)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {flowRows.length > 0 && flowRows[flowRows.length - 1]!.unspent < 0 ? (
                <p className="mt-2 text-[11px] text-[#8f8676]">
                  ⚠ {tr("Negative unspent means buys exceed recorded refills — a refill or sale may be missing.")}
                </p>
              ) : null}
            </article>
          </div>
        ) : null}
      </section>

      <section className={investingSubsectionStack}>
        <InvestingSubsectionHeader
          title="Refills"
          isOpen={isRefillsOpen}
          onToggle={() => setRefillsOpen((v) => !v)}
        />
        {isRefillsOpen ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-[#655d51]">
                {tr("Date (DD.MM.YYYY or YYYY-MM-DD), invest amount, commission in USD.")}
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr("Filter refills by year")}>
                {(["all", ...yearlyTable.map((y) => y.year).reverse()] as const).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setRefillYearFilter(y)}
                    className={[
                      "rounded-full px-2.5 py-1 text-xs font-medium transition",
                      refillYearFilter === y
                        ? "bg-[#1f1c17] text-[#f8f4eb]"
                        : "border border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]",
                    ].join(" ")}
                  >
                    {y === "all" ? tr("All") : y}
                  </button>
                ))}
              </div>
            </div>
            <div className={investingTableScrollWrap}>
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                  <tr>
                    <th className="px-2 py-2 font-medium">{tr("Date")}</th>
                    <th className="px-2 py-2 font-medium">{tr("Invest")}</th>
                    <th className="px-2 py-2 font-medium">{tr("Commission, $")}</th>
                    <th className="px-2 py-2 text-right font-medium">{tr("Cumulative")}</th>
                    <th className="px-2 py-2 font-medium">{tr("Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {refillRowsView.map(({ row, cumulative }) => (
                    <tr key={row.id} className="border-t border-black/5 align-top">
                      <td className="px-2 py-2">
                        <input
                          value={row.date}
                          onChange={(e) => updateRefill(row.id, { date: e.target.value })}
                          className={inputBaseClasses()}
                          placeholder="DD.MM.YYYY"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.amount}
                          onChange={(e) => updateRefill(row.id, { amount: e.target.value })}
                          className={inputBaseClasses()}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          value={row.commission}
                          onChange={(e) => updateRefill(row.id, { commission: e.target.value })}
                          className={inputBaseClasses()}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-2 py-2 pt-3 text-right tabular-nums text-[#8f8676]">{fmt2(cumulative)}</td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => deleteRefill(row.id)}
                          className={investingToolbarBtn}
                        >
                          {tr("Delete")}
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-black/15 bg-[#f6f3ea] font-medium">
                    <td className="px-2 py-2 text-[#1f1c17]">
                      {refillYearFilter === "all" ? tr("Total") : tr("Total {year}", { year: refillYearFilter })}
                    </td>
                    <td className="px-2 py-2 tabular-nums text-[#1f1c17]">{fmt2(filteredTotals.invest)}</td>
                    <td className="px-2 py-2 tabular-nums text-[#1f1c17]">{fmt2(filteredTotals.commission)}</td>
                    <td className="px-2 py-2" />
                    <td className="px-2 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}
