"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUsd, parseInvestingDateMs, parseUsd } from "@/features/investing/format";
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
import {
  useInvesting,
  type InvestingActivitiesImportSummary,
  type InvestingActivity,
} from "@/state/investing-store";

function importErrorMessage(err: unknown): string {
  const raw = (err as { message?: string })?.message ?? "Unknown error";
  try {
    const detail = (JSON.parse(raw) as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
  } catch {
    // Not a FastAPI JSON error body.
  }
  return raw;
}

function inputBaseClasses() {
  return "w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20 focus:bg-white";
}

function toneClass(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-[#6f675b]";
}

function signedUsd(n: number): string {
  return `${n > 0 ? "+" : ""}${formatUsd(n)}`;
}

/** USD figures are computed server-side on save; fall back to the native amount until then. */
function usd(row: InvestingActivity) {
  return {
    amount: parseUsd(row.amount_usd ?? row.amount),
    pnl: parseUsd(row.gains_losses_usd ?? row.gains_losses),
    fee: parseUsd(row.commission_usd ?? row.commission),
  };
}

type TypeFilter = "all" | "buy" | "sell";

const chip = (active: boolean) =>
  [
    "rounded-full px-3 py-1.5 text-xs font-medium transition",
    active ? "bg-[#1f1c17] text-[#f8f4eb]" : "border border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]",
  ].join(" ");

export default function InvestingActivitiesPage() {
  const {
    activities,
    activitiesSummary,
    activitiesMeta,
    isActivitiesLoading,
    isActivitiesSaving,
    isActivitiesDirty,
    updateActivity,
    addActivity,
    deleteActivity,
    saveActivities,
    importActivities,
  } = useInvesting();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<
    { ok: true; summary: InvestingActivitiesImportSummary } | { ok: false; message: string } | null
  >(null);

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const summary = await importActivities(file);
      setImportResult({ ok: true, summary });
      if (summary.added > 0) {
        // Show the new rows: they sit at the top in Edit mode, unfiltered.
        setMode("edit");
        setSearch("");
        setTypeFilter("all");
        setYearFilter("all");
      }
    } catch (err) {
      setImportResult({ ok: false, message: importErrorMessage(err) });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const [mode, setMode] = useState<"view" | "edit">("view");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [isTickersOpen, setTickersOpen] = useState(false);
  const [isYearlyOpen, setYearlyOpen] = useState(false);

  useEffect(() => {
    if (!isActivitiesDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isActivitiesDirty]);

  const withMeta = useMemo(
    () =>
      activities.map((row, index) => {
        const t = parseInvestingDateMs(row.date);
        return { row, index, t, year: t == null ? null : new Date(t).getUTCFullYear() };
      }),
    [activities],
  );

  const years = useMemo(
    () => [...new Set(withMeta.map((r) => r.year).filter((y): y is number => y != null))].sort((a, b) => b - a),
    [withMeta],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = withMeta.filter(({ row, year }) => {
      // Rows still being filled in (no ticker or date) always stay visible while editing.
      if (mode === "edit" && (!row.ticker.trim() || year == null)) return true;
      if (typeFilter !== "all" && row.type !== typeFilter) return false;
      if (yearFilter !== "all" && year !== yearFilter) return false;
      if (q && ![row.ticker, row.name, row.category].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
    // Newest first in View; Edit keeps stored order so rows don't jump while a date is typed.
    return mode === "view" ? [...rows].sort((a, b) => (b.t ?? Infinity) - (a.t ?? Infinity)) : rows;
  }, [withMeta, search, typeFilter, yearFilter, mode]);

  const summary = useMemo(() => {
    let bought = 0;
    let sold = 0;
    let pnl = 0;
    let fees = 0;
    let buys = 0;
    let sells = 0;
    for (const { row } of visible) {
      const u = usd(row);
      fees += u.fee;
      if (row.type === "sell") {
        sells += 1;
        sold += u.amount;
        pnl += u.pnl;
      } else {
        buys += 1;
        bought += u.amount;
      }
    }
    return { bought, sold, pnl, fees, buys, sells };
  }, [visible]);

  const typeCounts = useMemo(
    () => ({
      all: activities.length,
      buy: activities.filter((a) => a.type === "buy").length,
      sell: activities.filter((a) => a.type === "sell").length,
    }),
    [activities],
  );

  const byTicker = useMemo(() => {
    const map = new Map<
      string,
      { ticker: string; name: string; buys: number; sells: number; bought: number; sold: number; pnl: number; fees: number; last: number | null }
    >();
    for (const { row, t } of withMeta) {
      const ticker = row.ticker.trim().toUpperCase();
      if (!ticker) continue;
      const cur = map.get(ticker) ?? { ticker, name: row.name, buys: 0, sells: 0, bought: 0, sold: 0, pnl: 0, fees: 0, last: null };
      const u = usd(row);
      cur.fees += u.fee;
      if (row.type === "sell") {
        cur.sells += 1;
        cur.sold += u.amount;
        cur.pnl += u.pnl;
      } else {
        cur.buys += 1;
        cur.bought += u.amount;
      }
      if (t != null && (cur.last == null || t > cur.last)) cur.last = t;
      map.set(ticker, cur);
    }
    return [...map.values()].sort((a, b) => b.bought - a.bought);
  }, [withMeta]);

  const isFiltered = search.trim() !== "" || typeFilter !== "all" || yearFilter !== "all";
  const colCount = mode === "edit" ? 13 : 9;

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        Every buy and sell. USD amounts and FX rates are calculated when you save.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={investingMetaBadge}>
          {activitiesMeta.updatedAt ? `Synced ${new Date(activitiesMeta.updatedAt).toLocaleString()}` : "Not synced"}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xlsm,.csv"
            className="hidden"
            onChange={(e) => void handleImportFile(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
            title="Broker trade export: Trade#, Time, Ticker, Direction, Price, Quantity, Amount, Fee, Profit"
            className={["transition", isImporting ? investingPrimarySaveDisabled : investingToolbarBtn].join(" ")}
          >
            {isImporting ? "Importing…" : "Import XLSX"}
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
          {mode === "edit" ? (
            <>
              <button type="button" onClick={() => addActivity("buy")} className={investingToolbarBtn}>
                Add purchase
              </button>
              <button type="button" onClick={() => addActivity("sell")} className={investingToolbarBtn}>
                Add sale
              </button>
              <button
                type="button"
                onClick={() => void saveActivities()}
                disabled={!isActivitiesDirty || isActivitiesSaving || isActivitiesLoading}
                className={[
                  "transition",
                  !isActivitiesDirty || isActivitiesSaving || isActivitiesLoading
                    ? investingPrimarySaveDisabled
                    : investingPrimarySaveActive,
                ].join(" ")}
              >
                {isActivitiesSaving ? "Saving..." : "Save"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isActivitiesDirty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>
            <span aria-hidden>●</span> Unsaved changes — press Save to store them and recalculate USD amounts.
          </span>
          {mode === "view" ? (
            <button type="button" onClick={() => setMode("edit")} className={investingToolbarBtn}>
              Go to Edit
            </button>
          ) : null}
        </div>
      ) : null}

      {importResult ? (
        <div
          className={[
            "flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
            importResult.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900",
          ].join(" ")}
        >
          {importResult.ok ? (
            <div className="grid gap-0.5">
              <p className="font-medium">
                {importResult.summary.added > 0
                  ? `Added ${importResult.summary.added} trades (${importResult.summary.addedBuys} buys, ${importResult.summary.addedSells} sells) at the top — review and press Save.`
                  : "No new trades — everything in this file is already recorded."}
              </p>
              {importResult.summary.duplicates > 0 ? (
                <p>Already recorded, skipped: {importResult.summary.duplicates}</p>
              ) : null}
              {importResult.summary.skippedFx > 0 ? (
                <p>Currency exchanges (e.g. RUR/USD), skipped: {importResult.summary.skippedFx}</p>
              ) : null}
              {importResult.summary.invalid.length > 0 ? (
                <p>
                  Couldn&apos;t read {importResult.summary.invalid.length}:{" "}
                  {importResult.summary.invalid.slice(0, 5).join("; ")}
                  {importResult.summary.invalid.length > 5 ? "; …" : ""}
                </p>
              ) : null}
            </div>
          ) : (
            <p>Import failed: {importResult.message}</p>
          )}
          <button type="button" onClick={() => setImportResult(null)} className="text-xs opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ticker, name, category…"
          aria-label="Search activities"
          className="w-full max-w-xs rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20"
        />
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
          {(
            [
              ["all", "All"],
              ["buy", "Buys"],
              ["sell", "Sells"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setTypeFilter(key)} className={chip(typeFilter === key)}>
              {label} <span className="opacity-60">{typeCounts[key]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by year">
          {(["all", ...years] as const).map((y) => (
            <button key={y} type="button" onClick={() => setYearFilter(y)} className={chip(yearFilter === y)}>
              {y === "all" ? "All years" : y}
            </button>
          ))}
        </div>
      </div>

      {/* Summary of what is shown */}
      <section className="flex flex-wrap gap-x-8 gap-y-3 rounded-2xl border border-black/5 bg-white/90 px-5 py-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        {[
          { label: isFiltered ? "Trades shown" : "Trades", value: `${visible.length}`, sub: `${summary.buys} buys · ${summary.sells} sells` },
          { label: "Bought", value: formatUsd(summary.bought) },
          { label: "Sold", value: formatUsd(summary.sold) },
          { label: "Realized P&L", value: signedUsd(summary.pnl), tone: toneClass(summary.pnl) },
          {
            label: "Fees",
            value: formatUsd(summary.fees),
            sub:
              summary.bought + summary.sold > 0
                ? `${((summary.fees / (summary.bought + summary.sold)) * 100).toFixed(2)}% of volume`
                : undefined,
          },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[11px] text-[#8f8676]">{s.label}</p>
            <p className={`text-base font-semibold tabular-nums ${s.tone ?? "text-[#1f1c17]"}`}>{s.value}</p>
            {s.sub ? <p className="text-[11px] text-[#8f8676]">{s.sub}</p> : null}
          </div>
        ))}
      </section>

      {/* Trade log */}
      <div className={investingTableScrollWrap}>
        <table className={`w-full ${mode === "edit" ? "min-w-[1180px]" : "min-w-[860px]"} border-collapse text-left text-sm`}>
          <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
            {mode === "view" ? (
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Holding</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Shares</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">Amount (USD)</th>
                <th className="px-3 py-2 text-right font-medium">Realized P&L</th>
                <th className="px-3 py-2 text-right font-medium">Fee</th>
              </tr>
            ) : (
              <tr>
                <th className="w-[96px] px-3 py-2 font-medium">Type</th>
                <th className="w-[200px] px-3 py-2 font-medium">Name</th>
                <th className="w-[90px] px-3 py-2 font-medium">Ticker</th>
                <th className="w-[150px] px-3 py-2 font-medium">Category</th>
                <th className="w-[72px] px-3 py-2 font-medium">Count</th>
                <th className="w-[100px] px-3 py-2 font-medium">Price</th>
                <th className="w-[66px] px-3 py-2 font-medium">Currency</th>
                <th className="w-[100px] px-3 py-2 font-medium">Amount</th>
                <th className="w-[96px] px-3 py-2 font-medium">Gains/Losses</th>
                <th className="w-[90px] px-3 py-2 font-medium">Commission</th>
                <th className="w-[66px] px-3 py-2 font-medium">FX</th>
                <th className="w-[120px] px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium" />
              </tr>
            )}
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-8 text-center text-sm text-[#8f8676]">
                  {activities.length === 0 ? "No trades yet — switch to Edit and add a purchase." : "No trades match these filters."}
                </td>
              </tr>
            ) : null}
            {visible.map(({ row }) => {
              const u = usd(row);
              const isSell = row.type === "sell";
              if (mode === "view") {
                return (
                  <tr key={row.id} className="border-t border-black/5 hover:bg-[#faf8f2]">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#3b352d]">{row.date || "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          isSell ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800",
                        ].join(" ")}
                      >
                        <span aria-hidden>{isSell ? "↑" : "↓"}</span>
                        {isSell ? "Sell" : "Buy"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-[#1f1c17]">{row.ticker || "—"}</span>
                      {row.name && row.name.toUpperCase() !== row.ticker.toUpperCase() ? (
                        <span className="block max-w-[220px] truncate text-[11px] text-[#8f8676]" title={row.name}>
                          {row.name}
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-[180px] truncate px-3 py-2 text-xs text-[#6f675b]" title={row.category}>
                      {row.category || "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#3b352d]">{row.count}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#3b352d]">
                      {parseUsd(row.price).toLocaleString("en-US", { maximumFractionDigits: 4 })}{" "}
                      <span className="text-[11px] text-[#8f8676]">{row.currency || "USD"}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#1f1c17]">
                      {formatUsd(u.amount)}
                      {row.currency && row.currency !== "USD" ? (
                        <span className="block text-[11px] text-[#8f8676]">
                          {parseUsd(row.amount).toLocaleString("en-US")} {row.currency}
                        </span>
                      ) : null}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${isSell ? toneClass(u.pnl) : "text-[#b0a79a]"}`}>
                      {isSell ? signedUsd(u.pnl) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[#6f675b]">{formatUsd(u.fee)}</td>
                  </tr>
                );
              }
              return (
                <tr key={row.id} className="border-t border-black/5 align-top">
                  <td className="px-2 py-2">
                    <select
                      value={row.type}
                      onChange={(e) => updateActivity(row.id, { type: e.target.value as "buy" | "sell" })}
                      className={inputBaseClasses()}
                      aria-label="Type"
                    >
                      <option value="buy">Buy</option>
                      <option value="sell">Sell</option>
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.name} onChange={(e) => updateActivity(row.id, { name: e.target.value })} className={inputBaseClasses()} placeholder="Company" />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.ticker}
                      onChange={(e) => updateActivity(row.id, { ticker: e.target.value.toUpperCase() })}
                      className={`${inputBaseClasses()} ${row.ticker.trim() ? "" : "border-amber-300"}`}
                      placeholder="AAPL"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.category} onChange={(e) => updateActivity(row.id, { category: e.target.value })} className={inputBaseClasses()} placeholder="ETF / Banks / ..." />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={String(row.count)}
                      onChange={(e) => updateActivity(row.id, { count: Number(e.target.value.replace(",", ".")) || 0 })}
                      className={inputBaseClasses()}
                      inputMode="decimal"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.price} onChange={(e) => updateActivity(row.id, { price: e.target.value })} className={inputBaseClasses()} inputMode="decimal" />
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.currency} onChange={(e) => updateActivity(row.id, { currency: e.target.value.toUpperCase() })} className={inputBaseClasses()} placeholder="USD" />
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.amount} onChange={(e) => updateActivity(row.id, { amount: e.target.value })} className={inputBaseClasses()} inputMode="decimal" />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.gains_losses}
                      onChange={(e) => updateActivity(row.id, { gains_losses: e.target.value })}
                      className={inputBaseClasses()}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={!isSell}
                      title={isSell ? undefined : "Only sales have realized gains/losses"}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.commission} onChange={(e) => updateActivity(row.id, { commission: e.target.value })} className={inputBaseClasses()} inputMode="decimal" />
                  </td>
                  <td className="px-2 py-2">
                    <div className="w-full rounded-lg border border-black/10 bg-[#faf8f2] px-2 py-1.5 text-sm tabular-nums text-[#6f675b]">
                      {(Number(row.fx_rate_to_usd ?? "1") || 1).toFixed(row.currency && row.currency !== "USD" ? 4 : 1)}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.date}
                      onChange={(e) => updateActivity(row.id, { date: e.target.value })}
                      className={`${inputBaseClasses()} ${parseInvestingDateMs(row.date) == null ? "border-amber-300" : ""}`}
                      placeholder="dd.mm.yyyy"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => deleteActivity(row.id)} className={investingToolbarBtn}>
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mode === "edit" ? (
        <p className="-mt-2 text-[11px] text-[#8f8676]">
          Amber border = missing ticker or a date that isn&apos;t DD.MM.YYYY. New rows appear at the top and stay
          visible whatever the filters.
        </p>
      ) : null}

      {/* By ticker */}
      <section className={investingSubsectionStack}>
        <InvestingSubsectionHeader title={`By ticker (${byTicker.length})`} isOpen={isTickersOpen} onToggle={() => setTickersOpen((v) => !v)} />
        {isTickersOpen ? (
          <div className={investingTableScrollWrap}>
            <table className="w-full min-w-[760px] border-collapse text-left text-sm tabular-nums">
              <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className="px-3 py-2 font-medium">Ticker</th>
                  <th className="px-3 py-2 text-right font-medium">Buys / Sells</th>
                  <th className="px-3 py-2 text-right font-medium">Bought</th>
                  <th className="px-3 py-2 text-right font-medium">Sold</th>
                  <th className="px-3 py-2 text-right font-medium">Realized P&L</th>
                  <th className="px-3 py-2 text-right font-medium">Fees</th>
                  <th className="px-3 py-2 text-right font-medium">Last trade</th>
                </tr>
              </thead>
              <tbody>
                {byTicker.map((r) => (
                  <tr
                    key={r.ticker}
                    className="cursor-pointer border-t border-black/5 hover:bg-[#faf8f2]"
                    onClick={() => {
                      setSearch(r.ticker);
                      setTypeFilter("all");
                      setYearFilter("all");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    title="Show this ticker's trades"
                  >
                    <td className="px-3 py-2">
                      <span className="font-semibold text-[#1f1c17]">{r.ticker}</span>{" "}
                      <span className="text-[11px] text-[#8f8676]">{r.name !== r.ticker ? r.name : ""}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-[#3b352d]">
                      {r.buys} / {r.sells}
                    </td>
                    <td className="px-3 py-2 text-right text-[#3b352d]">{formatUsd(r.bought)}</td>
                    <td className="px-3 py-2 text-right text-[#3b352d]">{r.sold > 0 ? formatUsd(r.sold) : "—"}</td>
                    <td className={`px-3 py-2 text-right font-medium ${r.sells ? toneClass(r.pnl) : "text-[#b0a79a]"}`}>
                      {r.sells ? signedUsd(r.pnl) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-[#6f675b]">{formatUsd(r.fees)}</td>
                    <td className="px-3 py-2 text-right text-[#6f675b]">
                      {r.last == null ? "—" : new Date(r.last).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* Yearly totals */}
      <section className={investingSubsectionStack}>
        <InvestingSubsectionHeader title="Yearly totals" isOpen={isYearlyOpen} onToggle={() => setYearlyOpen((v) => !v)} />
        {isYearlyOpen ? (
          <div className={investingTableScrollWrap}>
            <table className="w-full min-w-[760px] border-collapse text-left text-sm tabular-nums">
              <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
                <tr>
                  <th className="px-3 py-2 font-medium">Year</th>
                  <th className="px-3 py-2 text-right font-medium">Purchases</th>
                  <th className="px-3 py-2 text-right font-medium">Purchase fees</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">Sale fees</th>
                  <th className="px-3 py-2 text-right font-medium">Realized P&L</th>
                  <th className="px-3 py-2 text-right font-medium" title="Sales − purchases − fees + realized P&L">
                    Net cash flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {activitiesSummary.map((row) => (
                  <tr key={row.year} className="border-t border-black/5">
                    <td className="px-3 py-2 font-semibold text-[#2f2922]">{row.year}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(parseUsd(row.purchases_amount))}</td>
                    <td className="px-3 py-2 text-right text-[#6f675b]">{formatUsd(parseUsd(row.purchases_commission))}</td>
                    <td className="px-3 py-2 text-right">{formatUsd(parseUsd(row.sales_amount))}</td>
                    <td className="px-3 py-2 text-right text-[#6f675b]">{formatUsd(parseUsd(row.sales_commission))}</td>
                    <td className={`px-3 py-2 text-right font-medium ${toneClass(parseUsd(row.sales_pnl))}`}>
                      {signedUsd(parseUsd(row.sales_pnl))}
                    </td>
                    <td className={`px-3 py-2 text-right ${toneClass(parseUsd(row.net_cash_flow))}`}>
                      {signedUsd(parseUsd(row.net_cash_flow))}
                    </td>
                  </tr>
                ))}
                {activitiesSummary.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-xs text-[#8f8676]">
                      No yearly data yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
