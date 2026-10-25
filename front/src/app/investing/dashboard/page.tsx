"use client";

import { useMemo, useState } from "react";
import { dividendsLast12mUsd } from "@/features/investing/broker-section";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useBroker } from "@/state/broker-store";
import { useInvesting } from "@/state/investing-store";
import { formatInvestingAxisDate, formatUsd, parseInvestingDateMs, parsePercent, parseUsd } from "@/features/investing/format";
import { CapitalValueLineChart } from "@/features/investing/charts/capital-value-line-chart";
import { DonutChart } from "@/features/investing/charts/donut-chart";
import { PortfolioAiReview } from "@/features/investing/dashboard/ai-review";
import { buildPositions, buildTotals } from "@/features/investing/dashboard/derive";
import {
  CATEGORICAL,
  CardHeader,
  ConcentrationCard,
  HoldingsHeatmap,
  KpiTile,
  OTHER_COLOR,
  PerformanceBars,
  RebalanceTable,
  SectorBars,
  TodayMovers,
  dashCard,
  signedPct,
  signedUsd,
  toneClass,
} from "@/features/investing/dashboard/widgets";
import {
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";

const cellInput = "rounded-lg border border-black/10 bg-white px-2 py-1.5 text-sm outline-none";

export default function InvestingDashboardPage() {
  const {
    holdings,
    holdingsMeta,
    isHoldingsLoading,
    activitiesSummary,
    refills,
    metrics,
    isMetricsLoading,
    updateMetrics,
    refreshMarketPrices,
    isMarketPricesLoading,
    capitalEntries,
    updateCapitalEntry,
    addCapitalEntry,
    deleteCapitalEntry,
    saveCapitalEntries,
    isCapitalEntriesDirty,
    isCapitalEntriesSaving,
  } = useInvesting();
  const { cashUsd, dividends } = useBroker();
  const { token } = useAuth();
  const t = useT();
  const locale = useLocale();
  const [nowMs] = useState(() => Date.now());
  const [isEditingEntries, setEditingEntries] = useState(false);
  const [metricsDraft, setMetricsDraft] = useState<null | { divYieldPercent: string; beta: string }>(null);

  const positions = useMemo(() => buildPositions(holdings), [holdings]);
  const totals = useMemo(() => buildTotals(positions), [positions]);

  // Money actually deposited (Finance → Refills), not cost basis, which includes reinvested gains.
  const topped = useMemo(() => refills.reduce((a, r) => a + parseUsd(r.amount), 0), [refills]);
  // What the account is worth: positions plus uninvested broker cash.
  const accountValue = totals.value + cashUsd;
  const dividends12m = useMemo(() => dividendsLast12mUsd(dividends, nowMs), [dividends, nowMs]);

  const realized = useMemo(() => {
    const pnl = activitiesSummary.reduce((a, y) => a + parseUsd(y.sales_pnl), 0);
    const fees = activitiesSummary.reduce(
      (a, y) => a + parseUsd(y.purchases_commission) + parseUsd(y.sales_commission),
      0,
    );
    return { pnl, fees };
  }, [activitiesSummary]);

  const divYield = parsePercent(metrics.divYieldPercent ?? "");
  const annualIncome = Number.isFinite(divYield) && divYield > 0 ? (totals.value * divYield) / 100 : null;

  const allocationSlices = useMemo(() => {
    const sorted = [...positions].sort((a, b) => b.weight - a.weight);
    const top = sorted.slice(0, 7);
    const other = sorted.slice(7).reduce((a, p) => a + p.weight, 0);
    // Color follows the ticker (alphabetical slot among those shown), not its rank.
    const slotOf = new Map([...top].map((p) => p.ticker).sort().map((t, i) => [t, i] as const));
    const slices = top.map((p) => ({ label: p.ticker, value: p.weight, color: CATEGORICAL[slotOf.get(p.ticker)!]! }));
    return other > 0 ? [...slices, { label: t("Other"), value: other, color: OTHER_COLOR }] : slices;
  }, [positions, t]);

  const capitalSeries = useMemo(
    () =>
      capitalEntries
        .map((e) => {
          const ms = parseInvestingDateMs(e.date);
          return ms == null ? null : { ms, label: formatInvestingAxisDate(ms), value: parseUsd(e.total_value) };
        })
        .filter((r): r is { ms: number; label: string; value: number } => r != null)
        .sort((a, b) => a.ms - b.ms)
        .map(({ label, value }) => ({ label, value })),
    [capitalEntries],
  );

  async function saveMetrics() {
    if (!metricsDraft) return;
    await updateMetrics({
      divYieldPercent: metricsDraft.divYieldPercent.trim() || "—",
      beta: metricsDraft.beta.trim() || "—",
    });
    setMetricsDraft(null);
  }

  if (positions.length === 0) {
    return (
      <div className={`${dashCard} text-sm text-[#655d51]`}>
        {isHoldingsLoading ? t("Loading portfolio…") : t("No holdings yet — add them or import an XLSX on the Portfolio tab.")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6f675b]">
        <span>
          {totals.hasQuotes ? t("Live prices") : t("Last saved prices")}
          {holdingsMeta.updatedAt ? ` · ${t("portfolio saved {when}", { when: new Date(holdingsMeta.updatedAt).toLocaleString(locale) })}` : ""}
        </span>
        <button
          type="button"
          onClick={() => void refreshMarketPrices().catch(() => {})}
          disabled={isMarketPricesLoading}
          className={isMarketPricesLoading ? investingPrimarySaveDisabled : investingToolbarBtn}
        >
          {isMarketPricesLoading ? t("Refreshing…") : t("Refresh market")}
        </button>
      </div>

      {/* Headline numbers */}
      <section className="grid gap-4 [&>*]:min-w-0 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile
          hero
          label="Portfolio value"
          value={formatUsd(totals.value)}
          sub={
            totals.hasQuotes ? (
              <span className={toneClass(totals.dayUsd)}>
                {t("{v} today", { v: `${signedUsd(totals.dayUsd)} (${signedPct(totals.dayPct)})` })}
              </span>
            ) : (
              t("Today's change appears after quotes load")
            )
          }
        />
        {topped > 0 ? (
          <KpiTile
            label="Total return"
            value={signedUsd(accountValue - topped)}
            valueTone={toneClass(accountValue - topped)}
            sub={
              <>
                <span className={`font-semibold ${toneClass(accountValue - topped)}`}>
                  {signedPct(((accountValue - topped) / topped) * 100, 1)}
                </span>{" "}
                {t("on {v} topped", { v: formatUsd(topped) })}
                {cashUsd > 0 ? ` · ${t("incl. {v} cash", { v: formatUsd(cashUsd) })}` : ""}
                <span className="mt-0.5 block text-[#8f8676]">
                  {t("Positions vs cost: {v}", { v: `${signedUsd(totals.pnl)} (${signedPct(totals.pnlPct, 1)})` })}
                </span>
              </>
            }
          />
        ) : (
          // No refills recorded yet: fall back to cost basis so the tile still says something useful.
          <KpiTile
            label="Total return (vs cost basis)"
            value={signedUsd(totals.pnl)}
            valueTone={toneClass(totals.pnl)}
            sub={
              <>
                <span className={`font-semibold ${toneClass(totals.pnlPct)}`}>{signedPct(totals.pnlPct, 1)}</span>{" "}
                {t("on {v} cost · add refills on Finance", { v: formatUsd(totals.cost) })}
              </>
            }
          />
        )}
        <KpiTile
          label="Today"
          value={totals.hasQuotes ? signedUsd(totals.dayUsd) : "—"}
          valueTone={toneClass(totals.dayUsd)}
          sub={
            totals.hasQuotes ? (
              <>
                ▲ {t("{n} up", { n: totals.up })} · ▼ {t("{n} down", { n: totals.down })}
              </>
            ) : (
              t("Waiting for quotes")
            )
          }
        />
        <KpiTile
          label="Realized P&L (sales)"
          value={signedUsd(realized.pnl)}
          valueTone={toneClass(realized.pnl)}
          sub={t("Fees paid {v}", { v: formatUsd(realized.fees) })}
        />
      </section>

      {/* Income & risk strip */}
      <section className={`${dashCard} flex flex-wrap items-center gap-x-8 gap-y-3 py-4`}>
        {metricsDraft ? (
          <>
            <label className="text-xs text-[#7f7668]">
              {t("Div yield")}
              <input
                value={metricsDraft.divYieldPercent}
                onChange={(e) => setMetricsDraft({ ...metricsDraft, divYieldPercent: e.target.value })}
                className={`${cellInput} ml-2 w-[90px]`}
                placeholder="1.5%"
              />
            </label>
            <label className="text-xs text-[#7f7668]">
              {t("Beta")}
              <input
                value={metricsDraft.beta}
                onChange={(e) => setMetricsDraft({ ...metricsDraft, beta: e.target.value })}
                className={`${cellInput} ml-2 w-[90px]`}
                placeholder="1.10"
              />
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => void saveMetrics()} className={investingPrimarySaveActive}>
                {t("Save")}
              </button>
              <button type="button" onClick={() => setMetricsDraft(null)} className={investingToolbarBtn}>
                {t("Cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            {[
              ["Div yield", isMetricsLoading ? "…" : metrics.divYieldPercent],
              ["Dividends, last 12 months", dividends.length ? formatUsd(dividends12m) : t("Not recorded")],
              ["Est. annual dividends", annualIncome == null ? "—" : formatUsd(annualIncome)],
              ["Est. monthly", annualIncome == null ? "—" : formatUsd(annualIncome / 12)],
              ["Beta", isMetricsLoading ? "…" : metrics.beta],
              ["Positions", t("{n} · {up} in profit · {down} in loss", { n: positions.length, up: totals.inProfit, down: totals.inLoss })],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[11px] text-[#8f8676]">{t(label)}</p>
                <p className="text-sm font-semibold tabular-nums text-[#1f1c17]">{value}</p>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setMetricsDraft({ divYieldPercent: metrics.divYieldPercent, beta: metrics.beta })}
              className={`${investingToolbarBtn} ml-auto`}
            >
              {t("Edit")}
            </button>
          </>
        )}
      </section>

      <PortfolioAiReview token={token} />

      {/* Today */}
      <section className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-3">
        <article className={`${dashCard} lg:col-span-2`}>
          <CardHeader title="Portfolio map" hint="Each tile is a holding, sized by weight and colored by today's move." />
          <div className="mt-3">
            <HoldingsHeatmap positions={positions} />
          </div>
        </article>
        <article className={dashCard}>
          <CardHeader title="Today's movers" hint="Session change and its $ effect on your position." />
          <TodayMovers positions={positions} />
        </article>
      </section>

      {/* Performance & allocation */}
      <section className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <article className={dashCard}>
          <CardHeader title="Winners & losers" hint="Total return on cost per holding." />
          <PerformanceBars positions={positions} />
        </article>
        <article className={dashCard}>
          <CardHeader title="Allocation" hint="By holding and by industry." />
          <div className="mt-3">
            <DonutChart title="By holding" slices={allocationSlices} size={180} />
          </div>
          <div className="mt-5 border-t border-black/5 pt-4">
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("By industry")}</p>
            <SectorBars positions={positions} />
          </div>
        </article>
      </section>

      {/* Risk & actions */}
      <section className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-5">
        <article className={`${dashCard} lg:col-span-2`}>
          <CardHeader title="Concentration risk" />
          <ConcentrationCard positions={positions} />
        </article>
        <article className={`${dashCard} lg:col-span-3`}>
          <CardHeader title="Rebalance to target" hint="What to buy or trim to match your target weights." />
          <RebalanceTable positions={positions} totalValue={totals.value} />
        </article>
      </section>

      {/* Capital history */}
      <section className="grid gap-4 [&>*]:min-w-0 lg:grid-cols-2">
        <CapitalValueLineChart data={capitalSeries} />
        <article className={dashCard}>
          <CardHeader
            title="Capital entries"
            hint="Deposits and portfolio total over time."
            right={
              isEditingEntries ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void saveCapitalEntries()}
                    disabled={!isCapitalEntriesDirty || isCapitalEntriesSaving}
                    className={
                      !isCapitalEntriesDirty || isCapitalEntriesSaving
                        ? investingPrimarySaveDisabled
                        : investingPrimarySaveActive
                    }
                  >
                    {isCapitalEntriesSaving ? t("Saving…") : t("Save")}
                  </button>
                  <button type="button" onClick={addCapitalEntry} className={investingToolbarBtn}>
                    {t("Add row")}
                  </button>
                  <button type="button" onClick={() => setEditingEntries(false)} className={investingToolbarBtn}>
                    {t("Done")}
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setEditingEntries(true)} className={investingToolbarBtn}>
                  {t("Edit table")}
                </button>
              )
            }
          />
          <div className="mt-4 overflow-x-auto rounded-xl border border-black/5">
            <table className="w-full border-collapse text-left">
              <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className="px-3 py-2.5 font-medium">{t("Date")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("Invested sum")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("Total value")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">%</th>
                  <th className="px-3 py-2.5 text-right font-medium">{t("1Y")}</th>
                  {isEditingEntries ? <th className="px-3 py-2.5 text-right font-medium">{t("Actions")}</th> : null}
                </tr>
              </thead>
              <tbody>
                {capitalEntries.map((d) => (
                  <tr key={d.id} className="border-t border-black/5 text-sm">
                    <td className="px-3 py-2.5 text-[#2f2922]">
                      {isEditingEntries ? (
                        <input
                          value={d.date}
                          onChange={(e) => updateCapitalEntry(d.id, { date: e.target.value })}
                          className={`${cellInput} w-[120px]`}
                        />
                      ) : (
                        d.date
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#2f2922]">
                      {isEditingEntries ? (
                        <input
                          value={d.deposit}
                          onChange={(e) => updateCapitalEntry(d.id, { deposit: e.target.value })}
                          className={`${cellInput} w-[110px] text-right`}
                        />
                      ) : (
                        d.deposit
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#2f2922]">
                      {isEditingEntries ? (
                        <input
                          value={d.total_value}
                          onChange={(e) => updateCapitalEntry(d.id, { total_value: e.target.value })}
                          className={`${cellInput} w-[110px] text-right`}
                        />
                      ) : (
                        d.total_value
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#2f2922]">{d.roi_percent}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#2f2922]">{d.one_year_percent}</td>
                    {isEditingEntries ? (
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" onClick={() => deleteCapitalEntry(d.id)} className={investingToolbarBtn}>
                          {t("Delete")}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </div>
  );
}
