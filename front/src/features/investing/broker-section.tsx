"use client";

import { useMemo, useState } from "react";
import { parseCryptoAmount } from "@/features/investing/crypto-format";
import { formatUsd, parseInvestingDateMs, parsePercent } from "@/features/investing/format";
import {
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingSubsectionStack,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { InvestingSubsectionHeader } from "@/features/investing/ui/investing-subsection-header";
import { newBrokerId, useBroker, type BrokerDividend } from "@/state/broker-store";
import { useInvesting } from "@/state/investing-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const input =
  "w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20 focus:bg-white";
const CURRENCIES = ["USD", "EUR", "RON", "UAH", "GBP", "RUB"];
const DAY = 24 * 60 * 60 * 1000;

/** Net dividend (gross − withheld tax) in USD. */
export function dividendNetUsd(d: BrokerDividend): number {
  return d.amount_usd - d.tax_usd;
}

/** Dividends received in the 12 months before `nowMs`, net of tax, in USD. */
export function dividendsLast12mUsd(rows: BrokerDividend[], nowMs: number): number {
  return rows.reduce((a, d) => {
    const t = parseInvestingDateMs(d.date);
    return t != null && t <= nowMs && t > nowMs - 365 * DAY ? a + dividendNetUsd(d) : a;
  }, 0);
}

export function BrokerCashAndDividends({ holdingsValue }: { holdingsValue: number }) {
  const { cash, dividends, cashUsd, isDirty, isSaving, setCash, setDividends, save } = useBroker();
  const { metrics } = useInvesting();
  const [open, setOpen] = useState(true);
  const [nowMs] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const cashShare = holdingsValue + cashUsd > 0 ? (cashUsd / (holdingsValue + cashUsd)) * 100 : 0;

  const stats = useMemo(() => {
    const year = new Date(nowMs).getUTCFullYear();
    const byYear = new Map<number, { gross: number; tax: number; count: number }>();
    const byTicker = new Map<string, number>();
    for (const d of dividends) {
      const t = parseInvestingDateMs(d.date);
      if (t == null) continue;
      const y = new Date(t).getUTCFullYear();
      const cur = byYear.get(y) ?? { gross: 0, tax: 0, count: 0 };
      cur.gross += d.amount_usd;
      cur.tax += d.tax_usd;
      cur.count += 1;
      byYear.set(y, cur);
      if (t > nowMs - 365 * DAY) {
        const tk = d.ticker.trim().toUpperCase() || "—";
        byTicker.set(tk, (byTicker.get(tk) ?? 0) + dividendNetUsd(d));
      }
    }
    const y = byYear.get(year);
    return {
      last12: dividendsLast12mUsd(dividends, nowMs),
      thisYear: y ? y.gross - y.tax : 0,
      allTime: dividends.reduce((a, d) => a + dividendNetUsd(d), 0),
      taxAll: dividends.reduce((a, d) => a + d.tax_usd, 0),
      years: [...byYear.entries()].sort((a, b) => b[0] - a[0]),
      topPayers: [...byTicker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [dividends, nowMs]);

  const estimated = (holdingsValue * parsePercent(metrics.divYieldPercent ?? "")) / 100;

  async function onSave() {
    setError(null);
    try {
      await save();
    } catch {
      setError("Couldn't save — try again.");
    }
  }

  return (
    <section className={investingSubsectionStack}>
      <InvestingSubsectionHeader title="Broker cash & dividends" isOpen={open} onToggle={() => setOpen((v) => !v)} />
      {open ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={!isDirty || isSaving}
              className={!isDirty || isSaving ? investingPrimarySaveDisabled : investingPrimarySaveActive}
            >
              {isSaving ? "Saving…" : "Save cash & dividends"}
            </button>
            {isDirty ? <span className="text-xs text-amber-800">● Unsaved changes</span> : null}
            {error ? <span className="text-xs text-rose-700">{error}</span> : null}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] [&>*]:min-w-0">
            {/* Cash */}
            <article className={card}>
              <h3 className="text-sm font-semibold text-[#1f1c17]">Uninvested cash at the broker</h3>
              <p className="mt-0.5 text-xs text-[#8f8676]">
                Counted in current value, total return and XIRR. Update it when you check your broker.
              </p>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-[#1f1c17]">{formatUsd(cashUsd)}</p>
              <p className="text-xs text-[#6f675b]">{cashShare.toFixed(1)}% of the account (holdings + cash)</p>
              <ul className="mt-3 space-y-2">
                {cash.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <input
                      value={c.amount}
                      onChange={(e) => setCash((rows) => rows.map((r) => (r.id === c.id ? { ...r, amount: e.target.value } : r)))}
                      className={`${input} text-right tabular-nums`}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Cash amount"
                    />
                    <select
                      value={c.currency}
                      onChange={(e) => setCash((rows) => rows.map((r) => (r.id === c.id ? { ...r, currency: e.target.value } : r)))}
                      className={`${input} w-24`}
                      aria-label="Currency"
                    >
                      {[...new Set([...CURRENCIES, c.currency])].map((cur) => (
                        <option key={cur} value={cur}>
                          {cur}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setCash((rows) => rows.filter((r) => r.id !== c.id))}
                      className="text-xs text-[#8f8676] hover:text-rose-700"
                      aria-label="Remove balance"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setCash((rows) => [...rows, { id: newBrokerId(), currency: rows.length ? "EUR" : "USD", amount: "" }])}
                className={`${investingToolbarBtn} mt-3`}
              >
                {cash.length ? "Add another currency" : "Add cash balance"}
              </button>
              {cash.some((c) => c.currency !== "USD") ? (
                <p className="mt-2 text-[11px] text-[#8f8676]">Other currencies are converted at official NBU rates.</p>
              ) : null}
            </article>

            {/* Dividends */}
            <article className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#1f1c17]">Dividends received</h3>
                <button
                  type="button"
                  onClick={() =>
                    setDividends((rows) => [
                      { id: newBrokerId(), date: "", ticker: "", amount: "", tax: "", currency: "USD", amount_usd: 0, tax_usd: 0 },
                      ...rows,
                    ])
                  }
                  className={investingToolbarBtn}
                >
                  Add dividend
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
                {[
                  { label: "Last 12 months (net)", value: formatUsd(stats.last12), sub: estimated > 0 ? `estimate at current yield: ${formatUsd(estimated)}` : "" },
                  { label: `${new Date(nowMs).getUTCFullYear()} so far`, value: formatUsd(stats.thisYear), sub: "" },
                  { label: "All time (net)", value: formatUsd(stats.allTime), sub: stats.taxAll > 0 ? `${formatUsd(stats.taxAll)} tax withheld` : "" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-[11px] text-[#8f8676]">{s.label}</p>
                    <p className="text-base font-semibold tabular-nums text-[#1f1c17]">{s.value}</p>
                    {s.sub ? <p className="text-[11px] text-[#8f8676]">{s.sub}</p> : null}
                  </div>
                ))}
                {stats.topPayers.length ? (
                  <div>
                    <p className="text-[11px] text-[#8f8676]">Top payers, 12 months</p>
                    <p className="text-xs text-[#3b352d]">{stats.topPayers.map(([t, v]) => `${t} ${formatUsd(v)}`).join(" · ")}</p>
                  </div>
                ) : null}
              </div>

              <div className={`${investingTableScrollWrap} mt-3 max-h-[360px] overflow-y-auto`}>
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 bg-[#f4efe4] text-xs text-[#7f7668]">
                    <tr>
                      <th className="px-2 py-2 font-medium">Date</th>
                      <th className="px-2 py-2 font-medium">Ticker</th>
                      <th className="px-2 py-2 font-medium">Gross</th>
                      <th className="px-2 py-2 font-medium">Tax withheld</th>
                      <th className="px-2 py-2 font-medium">Currency</th>
                      <th className="px-2 py-2 text-right font-medium">Net, USD</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {dividends.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-6 text-center text-xs text-[#8f8676]">
                          No dividends recorded yet — Add dividend for each payout your broker shows.
                        </td>
                      </tr>
                    ) : null}
                    {dividends.map((d) => {
                      const patch = (p: Partial<BrokerDividend>) =>
                        setDividends((rows) => rows.map((r) => (r.id === d.id ? { ...r, ...p } : r)));
                      const badDate = d.date.trim() !== "" && parseInvestingDateMs(d.date) == null;
                      // USD values come from the server; for unsaved non-USD rows they show after Save.
                      const netUsd =
                        d.currency === "USD" ? parseCryptoAmount(d.amount) - parseCryptoAmount(d.tax) : dividendNetUsd(d);
                      return (
                        <tr key={d.id} className="border-t border-black/5">
                          <td className="px-2 py-1.5">
                            <input value={d.date} onChange={(e) => patch({ date: e.target.value })} className={`${input} w-[110px] ${badDate ? "border-amber-400" : ""}`} placeholder="DD.MM.YYYY" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={d.ticker} onChange={(e) => patch({ ticker: e.target.value.toUpperCase() })} className={`${input} w-[90px]`} placeholder="VOO" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={d.amount} onChange={(e) => patch({ amount: e.target.value })} className={`${input} w-[90px] text-right tabular-nums`} inputMode="decimal" placeholder="0" />
                          </td>
                          <td className="px-2 py-1.5">
                            <input value={d.tax} onChange={(e) => patch({ tax: e.target.value })} className={`${input} w-[90px] text-right tabular-nums`} inputMode="decimal" placeholder="0" />
                          </td>
                          <td className="px-2 py-1.5">
                            <select value={d.currency} onChange={(e) => patch({ currency: e.target.value })} className={`${input} w-20`}>
                              {[...new Set([...CURRENCIES, d.currency])].map((cur) => (
                                <option key={cur} value={cur}>
                                  {cur}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-[#1f1c17]">{formatUsd(netUsd)}</td>
                          <td className="px-2 py-1.5 text-right">
                            <button
                              type="button"
                              onClick={() => setDividends((rows) => rows.filter((r) => r.id !== d.id))}
                              className="text-xs text-[#8f8676] hover:text-rose-700"
                              aria-label="Delete dividend"
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {stats.years.length ? (
                <p className="mt-2 text-xs text-[#6f675b]">
                  By year (net):{" "}
                  {stats.years.map(([y, v]) => `${y} ${formatUsd(v.gross - v.tax)} (${v.count})`).join(" · ")}
                </p>
              ) : null}
              <p className="mt-1 text-[11px] text-[#8f8676]">
                Dividends usually land in broker cash, so they&apos;re tracked here as income and not added to current
                value a second time. Non-USD amounts are converted at the payment date&apos;s rate when you save.
              </p>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
