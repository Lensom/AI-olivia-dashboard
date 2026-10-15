"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MonthlyTotalChart, type MonthlyTotalPoint } from "@/features/investing/charts/monthly-total-chart";
import { parseCryptoAmount } from "@/features/investing/crypto-format";
import { formatUsd, parseUsd } from "@/features/investing/format";
import { accountUsd, totalSums, type TotalAccount, type TotalCategory, type TotalSource } from "@/features/investing/total-stats";
import {
  investingMetaBadge,
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/state/auth-store";
import { useBroker } from "@/state/broker-store";
import { useCrypto } from "@/state/crypto-store";
import { useInvesting } from "@/state/investing-store";

// ---- Types (mirror back/app/investing/schemas.py) ----

type Category = TotalCategory;
type Source = TotalSource;
type Account = TotalAccount;
type Month = { id: string; month: string; total_usd: number; breakdown: Record<string, number> };
type TotalData = {
  accounts: Account[];
  goals: Record<string, number>;
  months: Month[];
  rate_overrides: Record<string, number>;
};

const GROUPS = [
  { key: "stocks", label: "Stocks", color: "#2a78d6" },
  { key: "savings", label: "Savings", color: "#1baf7a" },
  { key: "crypto", label: "Crypto", color: "#eda100" },
] as const;

const CATEGORY_LABEL: Record<Category, string> = {
  stocks: "Stocks",
  savings: "Savings",
  crypto: "Crypto",
  owed_to_me: "Owed to me",
  i_owe: "I owe",
};
const CURRENCIES = ["USD", "EUR", "RON", "UAH", "GBP", "PLN"];
const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€", UAH: "₴", GBP: "£", RON: "RON", PLN: "zł" };

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`);

/**
 * Starting point taken from the user's spreadsheet ("Total saving" + "Money" tables), used only while nothing
 * is saved yet. Stocks and Crypto are live from the app instead of typed amounts.
 */
function spreadsheetStart(): TotalData {
  const acc = (name: string, category: Category, amount: string, currency: string, source: Source = "manual"): Account => ({
    id: newId(),
    name,
    category,
    amount,
    currency,
    source,
  });
  const totals: [string, number][] = [
    ["2025-01", 14486.97], ["2025-02", 16321.13], ["2025-03", 16321.13], ["2025-04", 13568.45],
    ["2025-05", 15238.23], ["2025-06", 16821.35], ["2025-07", 18603.75], ["2025-08", 19812.72],
    ["2025-09", 20481.1], ["2025-10", 21514.43], ["2025-11", 22285.05], ["2025-12", 22997.53],
    ["2026-01", 21734.11], ["2026-02", 21588.41], ["2026-03", 19686.84], ["2026-04", 22349.29],
    ["2026-05", 28045.4], ["2026-06", 27458.65], ["2026-07", 38232.17], ["2026-08", 33367.37],
    ["2026-09", 32213.0],
  ];
  return {
    accounts: [
      acc("Stocks", "stocks", "", "USD", "stocks"),
      acc("ING", "savings", "35238", "RON"),
      acc("Savings", "savings", "4.24", "EUR"),
      acc("Crypto", "crypto", "", "USD", "crypto"),
      acc("Cash", "savings", "5", "EUR"),
      acc("Crypto (savings)", "savings", "834", "USD"),
      acc("Cash", "savings", "10", "RON"),
      acc("Cash", "savings", "352.10", "UAH"),
      acc("Debt (to me)", "owed_to_me", "0", "EUR"),
      acc("Debt (mine)", "i_owe", "0", "USD"),
    ],
    goals: { stocks: 70, savings: 20, crypto: 10 },
    months: totals.map(([month, total_usd]) => ({ id: newId(), month, total_usd, breakdown: {} })),
    rate_overrides: {},
  };
}

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const input =
  "w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20 focus:bg-white";

function monthLabel(ym: string, short = false): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: short ? "short" : "long",
    year: short ? "2-digit" : "numeric",
    timeZone: "UTC",
  });
}

function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[#1f1c17]";
  return n > 0 ? "text-emerald-700" : "text-rose-700";
}
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatUsd(n)}`;
const signedPct = (n: number | null, d = 1) => (n == null || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

export default function InvestingTotalPage() {
  const { token } = useAuth();
  const { holdings } = useInvesting();
  const { holdings: cryptoHoldings } = useCrypto();
  const { cashUsd: brokerCashUsd } = useBroker();

  const [data, setData] = useState<TotalData | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isPrefilled, setPrefilled] = useState(false);
  const [isDirty, setDirty] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [rates, setRates] = useState<{ to_usd: Record<string, number>; date: string | null } | null>(null);
  const [nowMonth] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    if (!token) return;
    apiFetch<TotalData & { updated_at: string | null }>("/investing/total", { token })
      .then((res) => {
        if (!res.updated_at) {
          setData(spreadsheetStart());
          setPrefilled(true);
          setDirty(true);
        } else {
          setData({ accounts: res.accounts, goals: res.goals, months: res.months, rate_overrides: res.rate_overrides });
        }
        setUpdatedAt(res.updated_at);
      })
      .catch(() => setSaveError("Couldn't load your totals."));
    apiFetch<{ to_usd: Record<string, number>; date: string | null }>("/investing/rates", { token })
      .then(setRates)
      .catch(() => setRates({ to_usd: { USD: 1 }, date: null }));
  }, [token]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const edit = useCallback((fn: (d: TotalData) => TotalData) => {
    setData((d) => (d ? fn(d) : d));
    setDirty(true);
  }, []);

  async function save() {
    if (!token || !data) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch<TotalData & { updated_at: string | null }>("/investing/total", {
        token,
        method: "PUT",
        body: JSON.stringify(data),
      });
      setData({ accounts: res.accounts, goals: res.goals, months: res.months, rate_overrides: res.rate_overrides });
      setUpdatedAt(res.updated_at);
      setDirty(false);
      setPrefilled(false);
    } catch {
      setSaveError("Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  }

  // ---- Live values ----
  // The live Stocks account is the whole broker account: positions plus uninvested cash.
  const stocksValue = useMemo(
    () => holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0) + brokerCashUsd,
    [holdings, brokerCashUsd],
  );
  const cryptoValue = useMemo(
    () => cryptoHoldings.reduce((a, h) => a + parseCryptoAmount(String(h.valueUsd ?? "")), 0),
    [cryptoHoldings],
  );

  const rateFor = useCallback(
    (cur: string): number | null => {
      const c = cur.trim().toUpperCase() || "USD";
      return data?.rate_overrides[c] ?? rates?.to_usd[c] ?? (c === "USD" ? 1 : null);
    },
    [data, rates],
  );

  const rows = useMemo(() => {
    return (data?.accounts ?? []).map((a) => ({ a, ...accountUsd(a, { stocks: stocksValue, crypto: cryptoValue }, rateFor) }));
  }, [data, stocksValue, cryptoValue, rateFor]);

  const sums = useMemo(() => totalSums(rows.map((r) => ({ category: r.a.category, usd: r.usd }))), [rows]);

  // ---- History ----
  const months = useMemo(() => [...(data?.months ?? [])].sort((a, b) => a.month.localeCompare(b.month)), [data]);
  const chart = useMemo<MonthlyTotalPoint[]>(
    () =>
      months.map((m, i) => ({
        key: m.id,
        label: monthLabel(m.month, true),
        value: m.total_usd,
        change: i > 0 ? m.total_usd - months[i - 1]!.total_usd : null,
      })),
    [months],
  );
  const last = months.filter((m) => m.month < nowMonth).at(-1) ?? null;
  const lastDec = months.filter((m) => m.month <= `${Number(nowMonth.slice(0, 4)) - 1}-12`).at(-1) ?? null;
  const yearAgo = months.filter((m) => m.month <= `${Number(nowMonth.slice(0, 4)) - 1}-${nowMonth.slice(5)}`).at(-1) ?? null;
  const thisMonthRecorded = months.find((m) => m.month === nowMonth);

  const yearEnds = useMemo(() => {
    const byYear = new Map<string, Month>();
    for (const m of months) byYear.set(m.month.slice(0, 4), m); // last month of each year wins
    const list = [...byYear.entries()].map(([year, m]) => ({ year, m }));
    return list.map((row, i) => {
      const prev = list[i - 1]?.m.total_usd;
      return { ...row, change: prev != null ? row.m.total_usd - prev : null, changePct: prev ? ((row.m.total_usd - prev) / prev) * 100 : null };
    });
  }, [months]);

  function recordMonth() {
    edit((d) => ({
      ...d,
      months: [
        ...d.months.filter((m) => m.month !== nowMonth),
        {
          id: thisMonthRecorded?.id ?? newId(),
          month: nowMonth,
          total_usd: Math.round(sums.net * 100) / 100,
          breakdown: Object.fromEntries(Object.entries(sums.by).map(([k, v]) => [k, Math.round(v * 100) / 100])),
        },
      ],
    }));
  }

  if (!data) {
    return (
      <div className={investingPageStack}>
        <p className="text-sm text-[#8f8676]">{saveError ?? "Loading…"}</p>
      </div>
    );
  }

  const goalsSum = GROUPS.reduce((a, g) => a + (data.goals[g.key] ?? 0), 0);
  const underweight = [...GROUPS]
    .map((g) => ({ g, gap: (data.goals[g.key] ?? 0) - (sums.assets > 0 ? (sums.by[g.key]! / sums.assets) * 100 : 0) }))
    .sort((a, b) => b.gap - a.gap)[0];
  const usedCurrencies = [...new Set(rows.filter((r) => !r.live).map((r) => r.a.currency.trim().toUpperCase() || "USD"))].filter(
    (c) => c !== "USD",
  );

  return (
    <div className={investingPageStack}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">Investing</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">Total</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-[#655d51]">
            Everything you own in one number: stocks and crypto live from the app, bank accounts and cash in any
            currency at official NBU rates, minus debts. Record it once a month to build your history.
          </p>
        </div>
        <Link href="/investing" className={investingToolbarBtn}>
          Back to Investing
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={investingMetaBadge}>{updatedAt ? `Saved ${new Date(updatedAt).toLocaleString()}` : "Not saved yet"}</span>
          <span className={investingMetaBadge}>
            Rates: NBU {rates?.date ?? "…"}
            {Object.keys(data.rate_overrides).length ? " · with your overrides" : ""}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={recordMonth}
            className={investingToolbarBtn}
            title="Store today's net worth as this month's total"
          >
            {thisMonthRecorded ? `Update ${monthLabel(nowMonth)}` : `Record ${monthLabel(nowMonth)}`}
          </button>
          <div className="flex rounded-full border border-black/10 bg-white p-1">
            {(["view", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition",
                  mode === m ? "bg-[#f3efe5] text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2]",
                ].join(" ")}
              >
                {m}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!isDirty || isSaving}
            className={!isDirty || isSaving ? investingPrimarySaveDisabled : investingPrimarySaveActive}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {isPrefilled ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Pre-filled from your spreadsheet: the accounts and monthly totals Jan 2025 – Sep 2026. Stocks and Crypto are
          live from the app. Check the numbers (Edit), then press <strong>Save</strong>.
        </div>
      ) : isDirty ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span aria-hidden>●</span> Unsaved changes — press Save to keep them.
        </div>
      ) : null}
      {saveError ? <p className="text-sm text-rose-700">{saveError}</p> : null}

      {/* Headline */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className={card}>
          <p className="text-xs text-[#7f7668]">Net worth</p>
          <p className="mt-1.5 text-3xl font-semibold tabular-nums text-[#1f1c17]">{formatUsd(sums.net)}</p>
          <p className="mt-1 text-xs text-[#6f675b]">
            Assets {formatUsd(sums.assets)}
            {sums.by.owed_to_me || sums.by.i_owe ? ` · debts ${signedUsd(sums.by.owed_to_me - sums.by.i_owe)}` : ""}
          </p>
        </article>
        {[
          { label: "Since last month", base: last, hint: last ? `vs ${monthLabel(last.month)}` : "No earlier month" },
          { label: "This year", base: lastDec, hint: lastDec ? `vs ${monthLabel(lastDec.month)}` : "No year-end month" },
          { label: "Last 12 months", base: yearAgo, hint: yearAgo ? `vs ${monthLabel(yearAgo.month)}` : "Less than a year of history" },
        ].map(({ label, base, hint }) => {
          const diff = base ? sums.net - base.total_usd : null;
          return (
            <article key={label} className={card}>
              <p className="text-xs text-[#7f7668]">{label}</p>
              <p className={`mt-1.5 text-xl font-semibold tabular-nums ${tone(diff)}`}>{diff == null ? "—" : signedUsd(diff)}</p>
              <p className="mt-1 text-xs text-[#6f675b]">
                {diff != null && base!.total_usd > 0 ? (
                  <span className={`font-semibold ${tone(diff)}`}>{signedPct((diff / base!.total_usd) * 100)} </span>
                ) : null}
                {hint}
              </p>
            </article>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] [&>*]:min-w-0">
        {/* Accounts */}
        <article className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#1f1c17]">Accounts</h2>
            {mode === "edit" ? (
              <button
                type="button"
                onClick={() =>
                  edit((d) => ({
                    ...d,
                    accounts: [...d.accounts, { id: newId(), name: "", category: "savings", amount: "", currency: "USD", source: "manual" }],
                  }))
                }
                className={investingToolbarBtn}
              >
                Add account
              </button>
            ) : null}
          </div>
          <div className={`${investingTableScrollWrap} mt-3`}>
            <table className={`w-full ${mode === "edit" ? "min-w-[720px]" : "min-w-[520px]"} border-collapse text-left text-sm`}>
              <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Group</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 text-right font-medium">USD</th>
                  {mode === "view" ? <th className="px-3 py-2 text-right font-medium">Share</th> : <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, usd, live, missingRate }) => {
                  const isDebt = a.category === "owed_to_me" || a.category === "i_owe";
                  if (mode === "edit") {
                    return (
                      <tr key={a.id} className="border-t border-black/5 align-top">
                        <td className="px-2 py-2">
                          <input
                            value={a.name}
                            onChange={(e) => edit((d) => ({ ...d, accounts: d.accounts.map((x) => (x.id === a.id ? { ...x, name: e.target.value } : x)) }))}
                            className={input}
                            placeholder="ING, Cash…"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            value={a.category}
                            onChange={(e) =>
                              edit((d) => ({ ...d, accounts: d.accounts.map((x) => (x.id === a.id ? { ...x, category: e.target.value as Category } : x)) }))
                            }
                            className={input}
                          >
                            {(Object.keys(CATEGORY_LABEL) as Category[]).map((c) => (
                              <option key={c} value={c}>
                                {CATEGORY_LABEL[c]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex gap-1.5">
                            <select
                              value={a.source}
                              onChange={(e) =>
                                edit((d) => ({ ...d, accounts: d.accounts.map((x) => (x.id === a.id ? { ...x, source: e.target.value as Source } : x)) }))
                              }
                              className={`${input} w-[118px]`}
                              aria-label="Source"
                            >
                              <option value="manual">Typed</option>
                              <option value="stocks">Live: Stocks</option>
                              <option value="crypto">Live: Crypto</option>
                            </select>
                            {a.source === "manual" ? (
                              <>
                                <input
                                  value={a.amount}
                                  onChange={(e) => edit((d) => ({ ...d, accounts: d.accounts.map((x) => (x.id === a.id ? { ...x, amount: e.target.value } : x)) }))}
                                  className={`${input} w-[110px] text-right tabular-nums`}
                                  inputMode="decimal"
                                  placeholder="0"
                                />
                                <select
                                  value={a.currency}
                                  onChange={(e) => edit((d) => ({ ...d, accounts: d.accounts.map((x) => (x.id === a.id ? { ...x, currency: e.target.value } : x)) }))}
                                  className={`${input} w-[78px]`}
                                  aria-label="Currency"
                                >
                                  {[...new Set([...CURRENCIES, a.currency])].map((c) => (
                                    <option key={c} value={c}>
                                      {c}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-[#6f675b]">{formatUsd(usd)}</td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => edit((d) => ({ ...d, accounts: d.accounts.filter((x) => x.id !== a.id) }))}
                            className={investingToolbarBtn}
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={a.id} className="border-t border-black/5 hover:bg-[#faf8f2]">
                      <td className="px-3 py-2.5 font-medium text-[#1f1c17]">
                        {a.name || "—"}
                        {live ? <span className="ml-1.5 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">LIVE</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-[#6f675b]">{CATEGORY_LABEL[a.category]}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#3b352d]">
                        {live ? (
                          <Link href={a.source === "stocks" ? "/investing/holdings" : "/investing/crypto"} className="text-xs underline decoration-black/15 underline-offset-2">
                            from {a.source === "stocks" ? (brokerCashUsd > 0 ? "Portfolio + cash" : "Portfolio") : "Crypto"}
                          </Link>
                        ) : (
                          `${parseCryptoAmount(a.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${CURRENCY_SIGN[a.currency] ?? a.currency}`
                        )}
                      </td>
                      <td className={`whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums ${a.category === "i_owe" && usd > 0 ? "text-rose-700" : "text-[#1f1c17]"}`}>
                        {missingRate ? <span title="No rate for this currency — add an override">⚠ no rate</span> : `${a.category === "i_owe" && usd > 0 ? "−" : ""}${formatUsd(usd)}`}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#6f675b]">
                        {isDebt || sums.assets <= 0 ? "—" : `${((usd / sums.assets) * 100).toFixed(1)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/15 bg-[#f6f3ea] font-semibold text-[#1f1c17]">
                  <td className="px-3 py-2" colSpan={3}>
                    Net worth
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatUsd(sums.net)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-[#8f8676]">
            Net worth = stocks + savings + crypto + owed to me − I owe. Shares are of assets (debts excluded).
          </p>
        </article>

        <div className="space-y-4">
          {/* Allocation vs goal */}
          <article className={card}>
            <h2 className="text-sm font-semibold text-[#1f1c17]">Mix vs goal</h2>
            <div className="mt-3 space-y-3">
              {GROUPS.map((g) => {
                const pct = sums.assets > 0 ? (sums.by[g.key]! / sums.assets) * 100 : 0;
                const goal = data.goals[g.key] ?? 0;
                return (
                  <div key={g.key}>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="inline-flex items-center gap-1.5 text-[#2f2922]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
                        {g.label}
                      </span>
                      <span className="text-xs tabular-nums text-[#6f675b]">
                        <span className="font-semibold text-[#1f1c17]">{pct.toFixed(1)}%</span> · {formatUsd(sums.by[g.key]!)} ·{" "}
                        {mode === "edit" ? (
                          <input
                            value={String(goal)}
                            onChange={(e) => edit((d) => ({ ...d, goals: { ...d.goals, [g.key]: Number(e.target.value.replace(",", ".")) || 0 } }))}
                            className="w-12 rounded border border-black/10 px-1 text-right"
                            inputMode="decimal"
                            aria-label={`${g.label} goal %`}
                          />
                        ) : (
                          goal
                        )}
                        % goal
                      </span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-black/5">
                      <div className="h-2 rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: g.color }} />
                      <div className="absolute -top-1 h-4 w-0.5 bg-[#1f1c17]" style={{ left: `${Math.min(100, goal)}%` }} title={`Goal ${goal}%`} />
                    </div>
                  </div>
                );
              })}
            </div>
            {Math.abs(goalsSum - 100) > 0.5 ? (
              <p className="mt-3 text-xs text-amber-800">⚠ Goals add up to {goalsSum}%, not 100%.</p>
            ) : underweight && underweight.gap > 1 ? (
              <p className="mt-3 text-xs text-[#3b352d]">
                Furthest below goal: <span className="font-semibold">{underweight.g.label}</span> by {underweight.gap.toFixed(1)} pp — reaching{" "}
                {data.goals[underweight.g.key]}% would take about{" "}
                {formatUsd(Math.max(0, ((data.goals[underweight.g.key] ?? 0) / 100) * sums.assets - sums.by[underweight.g.key]!))}{" "}
                more at today&apos;s total.
              </p>
            ) : (
              <p className="mt-3 text-xs text-emerald-800">✓ Within 1 pp of every goal.</p>
            )}
          </article>

          {/* Rates */}
          <article className={card}>
            <h2 className="text-sm font-semibold text-[#1f1c17]">Exchange rates</h2>
            <p className="mt-0.5 text-xs text-[#8f8676]">Official NBU rates {rates?.date ? `for ${rates.date}` : ""}. Override one only if you need a different rate.</p>
            <table className="mt-3 w-full text-sm tabular-nums">
              <tbody>
                {usedCurrencies.map((c) => {
                  const official = rates?.to_usd[c];
                  const override = data.rate_overrides[c];
                  const used = override ?? official;
                  return (
                    <tr key={c} className="border-t border-black/5">
                      <td className="py-1.5 font-medium text-[#1f1c17]">{c}</td>
                      <td className="py-1.5 text-right text-[#3b352d]">
                        {used ? (used >= 1 ? `1 ${c} = $${used.toFixed(4)}` : `$1 = ${(1 / used).toFixed(2)} ${c}`) : "—"}
                        {override != null ? <span className="ml-1 text-[11px] text-amber-700">override</span> : null}
                      </td>
                      {mode === "edit" ? (
                        <td className="py-1.5 pl-2 text-right">
                          <input
                            value={override != null ? String(override) : ""}
                            onChange={(e) => {
                              const v = Number(e.target.value.replace(",", "."));
                              edit((d) => {
                                const next = { ...d.rate_overrides };
                                if (e.target.value.trim() && v > 0) next[c] = v;
                                else delete next[c];
                                return { ...d, rate_overrides: next };
                              });
                            }}
                            className="w-28 rounded border border-black/10 px-1.5 py-0.5 text-right text-xs"
                            placeholder={official ? official.toFixed(4) : "USD per 1"}
                            aria-label={`${c} override, USD per 1`}
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {mode === "edit" ? <p className="mt-2 text-[11px] text-[#8f8676]">Override = USD per 1 unit. Leave empty to use NBU.</p> : null}
          </article>
        </div>
      </section>

      {/* History */}
      <article className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-[#1f1c17]">Net worth by month</h2>
            <p className="mt-0.5 text-xs text-[#8f8676]">
              Use “Record {monthLabel(nowMonth)}” once a month; it stores today&apos;s net worth with its breakdown.
            </p>
          </div>
          {mode === "edit" ? (
            <button
              type="button"
              onClick={() => edit((d) => ({ ...d, months: [...d.months, { id: newId(), month: "", total_usd: 0, breakdown: {} }] }))}
              className={investingToolbarBtn}
            >
              Add month
            </button>
          ) : null}
        </div>
        {chart.length > 0 ? (
          <div className="mt-3">
            <MonthlyTotalChart data={chart} />
          </div>
        ) : (
          <p className="mt-4 text-sm text-[#8f8676]">No months yet — press Record to add this month.</p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] [&>*]:min-w-0">
          <div className={`${investingTableScrollWrap} max-h-[420px] overflow-y-auto`}>
            <table className="w-full min-w-[460px] border-collapse text-left text-sm tabular-nums">
              <thead className="sticky top-0 bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className="px-3 py-2 font-medium">Month</th>
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {(mode === "edit" ? data.months : [...months].reverse()).map((m) => {
                  const idx = months.findIndex((x) => x.id === m.id);
                  const prev = idx > 0 ? months[idx - 1] : undefined;
                  const change = prev ? m.total_usd - prev.total_usd : null;
                  return (
                    <tr key={m.id} className="border-t border-black/5">
                      <td className="px-3 py-2 text-[#1f1c17]">
                        {mode === "edit" ? (
                          <input
                            type="month"
                            value={m.month}
                            onChange={(e) => edit((d) => ({ ...d, months: d.months.map((x) => (x.id === m.id ? { ...x, month: e.target.value } : x)) }))}
                            className={`${input} w-[150px]`}
                          />
                        ) : (
                          <>
                            {monthLabel(m.month)}
                            {Object.keys(m.breakdown).length ? <span className="ml-1.5 text-[10px] text-[#8f8676]" title="Recorded from the page with a breakdown">●</span> : null}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-[#1f1c17]">
                        {mode === "edit" ? (
                          <input
                            value={String(m.total_usd)}
                            onChange={(e) =>
                              edit((d) => ({ ...d, months: d.months.map((x) => (x.id === m.id ? { ...x, total_usd: parseCryptoAmount(e.target.value) } : x)) }))
                            }
                            className={`${input} w-[120px] text-right`}
                            inputMode="decimal"
                          />
                        ) : (
                          formatUsd(m.total_usd)
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right ${tone(change)}`}>{change == null ? "—" : signedUsd(change)}</td>
                      <td className="px-2 py-2 text-right">
                        {mode === "edit" ? (
                          <button type="button" onClick={() => edit((d) => ({ ...d, months: d.months.filter((x) => x.id !== m.id) }))} className={investingToolbarBtn}>
                            Delete
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={investingTableScrollWrap}>
            <table className="w-full border-collapse text-left text-sm tabular-nums">
              <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">Year-end</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {yearEnds.map((y) => (
                  <tr key={y.year} className="border-t border-black/5">
                    <td className="px-3 py-2 font-medium text-[#1f1c17]">
                      {y.year}
                      {y.m.month.slice(5) !== "12" ? <span className="ml-1 text-[11px] font-normal text-[#8f8676]">(to {monthLabel(y.m.month, true)})</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right text-[#1f1c17]">{formatUsd(y.m.total_usd)}</td>
                    <td className={`px-3 py-2 text-right ${tone(y.change)}`}>
                      {y.change == null ? "—" : `${signedUsd(y.change)} (${signedPct(y.changePct)})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  );
}
