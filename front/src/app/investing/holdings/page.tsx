"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { formatPercent, formatUsd, parsePercent, parseUsd } from "@/features/investing/format";
import type { InvestingHolding } from "@/features/investing/types";
import {
  investingMetaBadge,
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useInvesting, type InvestingHoldingsImportSummary } from "@/state/investing-store";

function inputBaseClasses() {
  return "w-full rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20 focus:bg-white";
}

function parseDayChangePct(s: string | undefined): number {
  const raw = String(s ?? "").trim();
  if (!raw || raw === "—") return NaN;
  const n = Number.parseFloat(raw.replace(/%/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function sortableDayChange(s: string | undefined): number {
  const n = parseDayChangePct(s);
  return Number.isFinite(n) ? n : -1e9;
}

function dayChangeCellClass(s: string | undefined): string {
  const n = parseDayChangePct(s);
  if (!Number.isFinite(n)) return "text-[#6f675b]";
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-[#6f675b]";
}

function toneClass(n: number): string {
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-rose-700";
  return "text-[#6f675b]";
}

function signedUsd(n: number): string {
  return `${n > 0 ? "+" : ""}${formatUsd(n)}`;
}

function signedPct(n: number, digits = 1): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

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

/** Numbers derived from a holding row, shared by cells, the detail panel and filters. */
function rowStats(h: InvestingHolding, totalValue: number) {
  const value = parseUsd(h.marketValue);
  const avg = parseUsd(h.avgBuyPrice);
  const price = parseUsd(h.marketPrice);
  const cost = h.shares * avg;
  const pnl = value - cost;
  const dayPct = parseDayChangePct(h.dayChangePercent);
  const target = parsePercent(h.targetWeight);
  const weight = parsePercent(h.currentWeight);
  const targetValue = (totalValue * target) / 100;
  return {
    value,
    cost,
    pnl,
    pnlPct: cost > 0 ? (pnl / cost) * 100 : 0,
    // value = prev × (1 + d) → today's move in $
    dayUsd: Number.isFinite(dayPct) ? value - value / (1 + dayPct / 100) : null,
    priceVsAvgPct: avg > 0 ? ((price - avg) / avg) * 100 : 0,
    target,
    drift: weight - target,
    rebalanceUsd: target > 0 ? targetValue - value : 0,
    rebalanceShares: target > 0 && price > 0 ? (targetValue - value) / price : 0,
  };
}

type SortKey =
  | "ticker"
  | "targetWeight"
  | "currentWeight"
  | "shares"
  | "avgBuyPrice"
  | "marketPrice"
  | "dayChangePercent"
  | "marketValue"
  | "pnl";

type RowFilter = "all" | "winners" | "losers" | "offTarget";

const FILTERS: { key: RowFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "winners", label: "Winners" },
  { key: "losers", label: "Losers" },
  { key: "offTarget", label: "Off target" },
];

export default function InvestingTablePage() {
  const {
    holdings,
    holdingsMeta,
    metrics,
    isMetricsLoading,
    refreshMetrics,
    updateHolding,
    addHolding,
    deleteHolding,
    reset,
    saveHoldings,
    refreshMarketPrices,
    isMarketPricesLoading,
    isHoldingsDirty,
    isHoldingsSaving,
    importHoldings,
    autofillHoldingProfiles,
  } = useInvesting();
  const tr = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<SortKey>("ticker");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<
    { ok: true; summary: InvestingHoldingsImportSummary } | { ok: false; message: string } | null
  >(null);
  const [isAutofilling, setAutofilling] = useState(false);
  const [autofillResult, setAutofillResult] = useState<string | null>(null);

  // Warn before closing the tab with unsaved edits (imports and autofill are unsaved until Save).
  useEffect(() => {
    if (!isHoldingsDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isHoldingsDirty]);

  async function handleImportFile(file: File | undefined) {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const summary = await importHoldings(file);
      setImportResult({ ok: true, summary });
      setMode("edit");
    } catch (err) {
      setImportResult({ ok: false, message: importErrorMessage(err) });
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAutofill() {
    setAutofilling(true);
    setAutofillResult(null);
    try {
      const { filled, notFound } = await autofillHoldingProfiles();
      if (filled.length === 0 && notFound.length === 0) {
        setAutofillResult(tr("Every holding already has a name and industry."));
      } else {
        setAutofillResult(
          [
            filled.length ? tr("Filled {list} — review and press Save.", { list: filled.join(", ") }) : "",
            notFound.length ? tr("No data for {list}.", { list: notFound.join(", ") }) : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
      }
    } catch (err) {
      setAutofillResult(tr("Autofill failed: {v}", { v: tr(importErrorMessage(err)) }));
    } finally {
      setAutofilling(false);
    }
  }

  const totals = useMemo(() => {
    const totalValue = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const totalCost = holdings.reduce((a, h) => a + h.shares * parseUsd(h.avgBuyPrice), 0);
    const totalTarget = holdings.reduce((a, h) => a + parsePercent(h.targetWeight), 0);
    const totalCurrent = holdings.reduce((a, h) => a + parsePercent(h.currentWeight), 0);
    const quoted = holdings.filter((h) => Number.isFinite(parseDayChangePct(h.dayChangePercent)));
    const dayUsd = quoted.reduce((a, h) => a + (rowStats(h, totalValue).dayUsd ?? 0), 0);
    return {
      totalValue,
      totalCost,
      totalPnl: totalValue - totalCost,
      totalPnlPct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      totalTarget,
      totalCurrent,
      dayUsd,
      dayPct: totalValue - dayUsd > 0 ? (dayUsd / (totalValue - dayUsd)) * 100 : 0,
      hasQuotes: quoted.length > 0,
    };
  }, [holdings]);

  const statsById = useMemo(
    () => new Map(holdings.map((h) => [h.id, rowStats(h, totals.totalValue)])),
    [holdings, totals.totalValue],
  );

  const sortedHoldings = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    const q = search.trim().toLowerCase();
    // Search and filters only apply in View mode, so a freshly added row is never hidden while editing.
    const visible =
      mode === "edit"
        ? holdings
        : holdings.filter((h) => {
            const s = statsById.get(h.id)!;
            if (q && ![h.ticker, h.name, h.industry].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
            if (rowFilter === "winners") return s.pnl > 0;
            if (rowFilter === "losers") return s.pnl < 0;
            if (rowFilter === "offTarget") return s.target > 0 && Math.abs(s.drift) >= 1;
            return true;
          });
    return [...visible].sort((a, b) => {
      const compareNum = (x: number, y: number) => (x - y) * factor;
      const compareStr = (x: string, y: string) => x.localeCompare(y) * factor;

      switch (sortBy) {
        case "ticker":
          return compareStr(a.ticker, b.ticker);
        case "targetWeight":
          return compareNum(parsePercent(a.targetWeight), parsePercent(b.targetWeight));
        case "currentWeight":
          return compareNum(parsePercent(a.currentWeight), parsePercent(b.currentWeight));
        case "shares":
          return compareNum(a.shares, b.shares);
        case "avgBuyPrice":
          return compareNum(parseUsd(a.avgBuyPrice), parseUsd(b.avgBuyPrice));
        case "marketPrice":
          return compareNum(parseUsd(a.marketPrice), parseUsd(b.marketPrice));
        case "dayChangePercent":
          return compareNum(sortableDayChange(a.dayChangePercent), sortableDayChange(b.dayChangePercent));
        case "marketValue":
          return compareNum(parseUsd(a.marketValue), parseUsd(b.marketValue));
        case "pnl":
          return compareNum(parseUsd(a.pnl), parseUsd(b.pnl));
        default:
          return 0;
      }
    });
  }, [holdings, sortBy, sortDir, search, rowFilter, mode, statsById]);

  const filterCounts = useMemo(() => {
    const all = [...statsById.values()];
    return {
      all: all.length,
      winners: all.filter((s) => s.pnl > 0).length,
      losers: all.filter((s) => s.pnl < 0).length,
      offTarget: all.filter((s) => s.target > 0 && Math.abs(s.drift) >= 1).length,
    } satisfies Record<RowFilter, number>;
  }, [statsById]);

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(key);
    setSortDir("asc");
  }

  function sortArrow(key: SortKey) {
    if (sortBy !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  function toggleExpanded(id: string) {
    setExpandedRowIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const isFiltered = mode === "view" && (search.trim() !== "" || rowFilter !== "all");

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        {tr("Day % is today’s session move from market data — use Refresh market.")}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs text-[#6f675b]">
          <span className={investingMetaBadge}>{tr("Total value {v}", { v: formatUsd(totals.totalValue) })}</span>
          <span className={investingMetaBadge}>{tr("Target sum {v}", { v: formatPercent(totals.totalTarget) })}</span>
          <span className={investingMetaBadge}>{tr("Current sum {v}", { v: formatPercent(totals.totalCurrent) })}</span>
          <span className={investingMetaBadge}>
            {tr("Source {v}", { v: holdingsMeta.source })}
            {holdingsMeta.updatedAt ? ` · ${tr("synced {when}", { when: new Date(holdingsMeta.updatedAt).toLocaleString(locale) })}` : ""}
          </span>
          <span className={investingMetaBadge}>{tr("Div yield")} {isMetricsLoading ? "…" : metrics.divYieldPercent}</span>
          <span className={investingMetaBadge}>{tr("Beta")} {isMetricsLoading ? "…" : metrics.beta}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void refreshMarketPrices().catch(() => {})}
            disabled={isMarketPricesLoading}
            className={[
              "transition",
              isMarketPricesLoading ? investingPrimarySaveDisabled : investingToolbarBtn,
            ].join(" ")}
          >
            {isMarketPricesLoading ? tr("Refreshing…") : tr("Refresh market")}
          </button>
          <button
            onClick={() => void refreshMetrics().catch(() => {})}
            disabled={isMetricsLoading}
            className={[
              "transition",
              isMetricsLoading ? investingPrimarySaveDisabled : investingToolbarBtn,
            ].join(" ")}
          >
            {isMetricsLoading ? tr("Refreshing metrics…") : tr("Refresh metrics")}
          </button>
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
            title={tr("Columns: Ticker, Qty, Entry Price, Price, Value")}
            className={["transition", isImporting ? investingPrimarySaveDisabled : investingToolbarBtn].join(" ")}
          >
            {isImporting ? tr("Importing…") : tr("Import XLSX")}
          </button>
          <div className="flex rounded-full border border-black/10 bg-white p-1">
            <button
              type="button"
              onClick={() => setMode("view")}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                mode === "view" ? "bg-[#f3efe5] text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2]",
              ].join(" ")}
            >
              {tr("View")}
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                mode === "edit" ? "bg-[#f3efe5] text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2]",
              ].join(" ")}
            >
              {tr("Edit")}
            </button>
          </div>

          {mode === "edit" ? (
            <>
              <button
                onClick={() => void saveHoldings().catch(() => {})}
                disabled={!isHoldingsDirty || isHoldingsSaving}
                className={[
                  "transition",
                  !isHoldingsDirty || isHoldingsSaving ? investingPrimarySaveDisabled : investingPrimarySaveActive,
                ].join(" ")}
              >
                {isHoldingsSaving ? tr("Saving…") : tr("Save")}
              </button>
              <button onClick={addHolding} className={investingPrimarySaveActive}>
                {tr("Add row")}
              </button>
              <button
                type="button"
                onClick={() => void handleAutofill()}
                disabled={isAutofilling}
                title={tr("Fill empty names and industries from Finviz")}
                className={["transition", isAutofilling ? investingPrimarySaveDisabled : investingToolbarBtn].join(" ")}
              >
                {isAutofilling ? tr("Looking up…") : tr("Autofill names & industry")}
              </button>
              <button onClick={reset} className={investingToolbarBtn}>
                {tr("Reset")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isHoldingsDirty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>
            <span aria-hidden>●</span> {tr("Unsaved changes — press Save to store them in the database.")}
          </span>
          {mode === "view" ? (
            <button type="button" onClick={() => setMode("edit")} className={investingToolbarBtn}>
              {tr("Go to Edit")}
            </button>
          ) : null}
        </div>
      ) : null}

      {autofillResult ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-black/10 bg-[#faf8f2] px-4 py-3 text-sm text-[#3b352d]">
          <p>{autofillResult}</p>
          <button type="button" onClick={() => setAutofillResult(null)} className="text-xs opacity-70 hover:opacity-100">
            {tr("Dismiss")}
          </button>
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
                {tr("Imported: {updated} updated, {added} added. Review and press Save to store in the database.", {
                  updated: importResult.summary.updated.length,
                  added: importResult.summary.added.length,
                })}
              </p>
              {importResult.summary.added.length > 0 ? (
                <p>
                  {tr("New: {list} — use Autofill names & industry, then set targets.", { list: importResult.summary.added.join(", ") })}
                </p>
              ) : null}
              {importResult.summary.notInFile.length > 0 ? (
                <p>{tr("Not in file (kept, delete if sold): {list}", { list: importResult.summary.notInFile.join(", ") })}</p>
              ) : null}
              {importResult.summary.skipped.length > 0 ? (
                <p>{tr("Skipped (missing Qty or Entry Price): {list}", { list: importResult.summary.skipped.join(", ") })}</p>
              ) : null}
            </div>
          ) : (
            <p>{tr("Import failed: {v}", { v: tr(importResult.message) })}</p>
          )}
          <button type="button" onClick={() => setImportResult(null)} className="text-xs opacity-70 hover:opacity-100">
            {tr("Dismiss")}
          </button>
        </div>
      ) : null}

      {mode === "view" ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("Search ticker, name, industry…")}
            aria-label={tr("Search holdings")}
            className="w-full max-w-xs rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20"
          />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={tr("Filter holdings")}>
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setRowFilter(f.key)}
                className={[
                  "rounded-full px-3 py-1.5 text-xs font-medium transition",
                  rowFilter === f.key
                    ? "bg-[#1f1c17] text-[#f8f4eb]"
                    : "border border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]",
                ].join(" ")}
              >
                {tr(f.label)} <span className="opacity-60">{filterCounts[f.key]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] table-fixed border-collapse text-left tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#f4efe4] text-xs text-[#7f7668]">
              <tr>
                <th className="w-[52px] px-2 py-2 font-medium" />
                <th className="w-[88px] px-2 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("ticker")} className="inline-flex items-center gap-1">
                    {tr("Ticker")} <span>{sortArrow("ticker")}</span>
                  </button>
                </th>
                <th className="w-[180px] px-2 py-2 text-left font-medium">{tr("Name")}</th>
                <th className="w-[80px] px-2 py-2 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("targetWeight")}
                    className="inline-flex items-center gap-1"
                  >
                    {tr("Target")} <span>{sortArrow("targetWeight")}</span>
                  </button>
                </th>
                <th className="w-[84px] px-2 py-2 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("currentWeight")}
                    className="inline-flex items-center gap-1"
                  >
                    {tr("Current")} <span>{sortArrow("currentWeight")}</span>
                  </button>
                </th>
                <th className="w-[62px] px-2 py-2 text-left font-medium">
                  <button type="button" onClick={() => toggleSort("shares")} className="inline-flex items-center gap-1">
                    {tr("Shares")} <span>{sortArrow("shares")}</span>
                  </button>
                </th>
                <th className="w-[90px] px-2 py-2 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("avgBuyPrice")}
                    className="inline-flex items-center gap-1"
                  >
                    {tr("Avg buy")} <span>{sortArrow("avgBuyPrice")}</span>
                  </button>
                </th>
                <th className="w-[90px] px-2 py-2 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("marketPrice")}
                    className="inline-flex items-center gap-1"
                  >
                    {tr("Market")} <span>{sortArrow("marketPrice")}</span>
                  </button>
                </th>
                <th className="w-[86px] px-2 py-2 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("dayChangePercent")}
                    className="inline-flex items-center gap-1"
                  >
                    {tr("Day")} <span>{sortArrow("dayChangePercent")}</span>
                  </button>
                </th>
                <th className="w-[100px] px-2 py-2 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => toggleSort("marketValue")}
                    className="inline-flex items-center gap-1"
                  >
                    {tr("Value")} <span>{sortArrow("marketValue")}</span>
                  </button>
                </th>
                <th className="w-[116px] px-2 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("pnl")} className="inline-flex items-center gap-1">
                    {tr("P&L")} <span>{sortArrow("pnl")}</span>
                  </button>
                </th>
                {mode === "edit" ? <th className="w-[88px] px-2 py-2 font-medium">{tr("Actions")}</th> : null}
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.length === 0 ? (
                <tr>
                  <td colSpan={mode === "edit" ? 12 : 11} className="px-4 py-8 text-center text-sm text-[#8f8676]">
                    {holdings.length === 0
                      ? tr("No holdings yet — Add row in Edit mode, or Import XLSX.")
                      : tr("No holdings match this search or filter.")}
                  </td>
                </tr>
              ) : null}
              {sortedHoldings.map((h) => {
                const s = statsById.get(h.id)!;
                return (
                  <Fragment key={h.id}>
                    <tr
                      className="border-t border-black/5 align-top transition hover:bg-[#faf8f2]"
                      onClick={(e) => {
                        const target = e.target as HTMLElement;
                        if (target.closest("input,button,a")) return;
                        toggleExpanded(h.id);
                      }}
                    >
                      {mode === "edit" ? (
                        <>
                          <td className="px-2 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => toggleExpanded(h.id)}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-black/10 text-sm font-semibold text-[#6f675b] hover:bg-[#f4efe4]"
                            >
                              {expandedRowIds[h.id] ? "−" : "+"}
                            </button>
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={h.ticker}
                              onChange={(e) => updateHolding(h.id, { ticker: e.target.value.toUpperCase() })}
                              className={`${inputBaseClasses()} font-semibold`}
                              placeholder="AAPL"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              value={h.name}
                              onChange={(e) => updateHolding(h.id, { name: e.target.value })}
                              className={inputBaseClasses()}
                              placeholder={tr("Company name")}
                            />
                          </td>
                          <td className="px-2 py-2 text-left">
                            <input
                              value={h.targetWeight}
                              onChange={(e) => updateHolding(h.id, { targetWeight: e.target.value })}
                              onBlur={() =>
                                updateHolding(h.id, {
                                  targetWeight: formatPercent(parsePercent(h.targetWeight)),
                                })
                              }
                              className={`${inputBaseClasses()} text-left tabular-nums`}
                              inputMode="decimal"
                              placeholder="10.0%"
                            />
                          </td>
                          <td className="px-2 py-2 text-left">
                            <div className="w-full rounded-lg border border-black/10 bg-[#faf8f2] px-2 py-1.5 text-left text-sm font-semibold tabular-nums text-[#2f2922]">
                              {formatPercent(parsePercent(h.currentWeight))}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-left">
                            <input
                              value={String(h.shares)}
                              onChange={(e) => updateHolding(h.id, { shares: Number(e.target.value) || 0 })}
                              className={`${inputBaseClasses()} text-left tabular-nums`}
                              inputMode="decimal"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-2 py-2 text-left">
                            <input
                              value={h.avgBuyPrice}
                              onChange={(e) => updateHolding(h.id, { avgBuyPrice: e.target.value })}
                              onBlur={() => updateHolding(h.id, { avgBuyPrice: formatUsd(parseUsd(h.avgBuyPrice)) })}
                              className={`${inputBaseClasses()} text-left tabular-nums`}
                              inputMode="decimal"
                              placeholder="$0.00"
                            />
                          </td>
                          <td className="px-2 py-2 text-left">
                            <input
                              value={h.marketPrice}
                              onChange={(e) => updateHolding(h.id, { marketPrice: e.target.value })}
                              onBlur={() => updateHolding(h.id, { marketPrice: formatUsd(parseUsd(h.marketPrice)) })}
                              className={`${inputBaseClasses()} text-left tabular-nums`}
                              inputMode="decimal"
                              placeholder="$0.00"
                            />
                          </td>
                          <td className="px-2 py-2 text-left">
                            <div
                              title={tr("Session change from quotes (Yahoo). Refresh market to update.")}
                              className={[
                                "w-full rounded-lg border border-black/10 bg-[#faf8f2] px-2 py-1.5 text-sm font-semibold tabular-nums",
                                dayChangeCellClass(h.dayChangePercent),
                              ].join(" ")}
                            >
                              {h.dayChangePercent ?? "—"}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-left">
                            <input
                              value={h.marketValue}
                              onChange={(e) => updateHolding(h.id, { marketValue: e.target.value })}
                              onBlur={() => updateHolding(h.id, { marketValue: formatUsd(parseUsd(h.marketValue)) })}
                              className={`${inputBaseClasses()} text-left tabular-nums`}
                              inputMode="decimal"
                              placeholder="$0.00"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <div
                              className={[
                                "w-full rounded-lg border border-black/10 bg-[#faf8f2] px-2 py-1.5 text-sm font-semibold tabular-nums",
                                parseUsd(h.pnl) >= 0 ? "text-emerald-700" : "text-rose-700",
                              ].join(" ")}
                            >
                              {formatUsd(parseUsd(h.pnl))}
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <button onClick={() => deleteHolding(h.id)} className={investingToolbarBtn} type="button">
                              {tr("Delete")}
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-2 py-2 text-center text-sm text-[#8f8676]">
                            {expandedRowIds[h.id] ? "−" : "+"}
                          </td>
                          <td className="px-2 py-2 text-sm font-semibold text-[#2f2922]">{h.ticker}</td>
                          <td className="px-2 py-2 text-sm text-[#2f2922]">
                            <span className="block truncate" title={h.name}>
                              {h.name}
                            </span>
                            {h.industry && h.industry !== "—" ? (
                              <span className="block truncate text-[11px] text-[#8f8676]" title={h.industry}>
                                {h.industry}
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums text-[#2f2922]">
                            {formatPercent(parsePercent(h.targetWeight))}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums text-[#2f2922]">
                            {formatPercent(parsePercent(h.currentWeight))}
                            {s.target > 0 && Math.abs(s.drift) >= 1 ? (
                              <span
                                className="block text-[11px] text-[#8f8676]"
                                title={tr("Current − target, percentage points")}
                              >
                                {s.drift > 0 ? "▲" : "▼"} {Math.abs(s.drift).toFixed(1)} {tr("pp")}
                              </span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums text-[#2f2922]">
                            {h.shares}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums text-[#2f2922]">
                            {formatUsd(parseUsd(h.avgBuyPrice))}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums text-[#2f2922]">
                            {formatUsd(parseUsd(h.marketPrice))}
                          </td>
                          <td
                            className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums"
                            title={tr("Session change from quotes. Refresh market to update.")}
                          >
                            <span className={`font-semibold ${dayChangeCellClass(h.dayChangePercent)}`}>
                              {h.dayChangePercent ?? "—"}
                            </span>
                            {s.dayUsd != null ? (
                              <span className="block text-[11px] text-[#8f8676]">{signedUsd(s.dayUsd)}</span>
                            ) : null}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums text-[#2f2922]">
                            {formatUsd(parseUsd(h.marketValue))}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-left text-sm tabular-nums">
                            <span className={`font-semibold ${toneClass(s.pnl)}`}>{signedUsd(s.pnl)}</span>
                            <span className={`block text-[11px] ${toneClass(s.pnlPct)}`}>{signedPct(s.pnlPct)}</span>
                          </td>
                        </>
                      )}
                    </tr>
                    {expandedRowIds[h.id] ? (
                      <tr className="border-t border-black/5 bg-[#faf8f2]/70">
                        <td colSpan={mode === "edit" ? 12 : 11} className="px-4 py-3 text-sm">
                          {mode === "edit" ? (
                            <div className="grid gap-2 md:grid-cols-2">
                              <label className="text-xs text-[#6f675b]">
                                {tr("Industry")}
                                <input
                                  value={h.industry}
                                  onChange={(e) => updateHolding(h.id, { industry: e.target.value })}
                                  className={`${inputBaseClasses()} mt-1`}
                                  placeholder="ETF / Tech / ..."
                                />
                              </label>
                            </div>
                          ) : (
                            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-5">
                              <div>
                                <p className="text-[11px] text-[#8f8676]">{tr("Cost basis")}</p>
                                <p className="font-semibold text-[#1f1c17]">{formatUsd(s.cost)}</p>
                                <p className="text-[11px] text-[#8f8676]">
                                  {h.shares} × {formatUsd(parseUsd(h.avgBuyPrice))}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[#8f8676]">{tr("Price vs avg buy")}</p>
                                <p className={`font-semibold ${toneClass(s.priceVsAvgPct)}`}>
                                  {signedPct(s.priceVsAvgPct)}
                                </p>
                                <p className="text-[11px] text-[#8f8676]">
                                  {tr("{v} now", { v: formatUsd(parseUsd(h.marketPrice)) })}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[#8f8676]">{tr("Weight vs target")}</p>
                                <p className="font-semibold text-[#1f1c17]">
                                  {formatPercent(parsePercent(h.currentWeight))}{" "}
                                  <span className="font-normal text-[#8f8676]">
                                    / {s.target > 0 ? formatPercent(s.target) : tr("no target")}
                                  </span>
                                </p>
                                <p className="text-[11px]">
                                  {s.target <= 0 ? (
                                    <span className="text-[#8f8676]">{tr("Set a target in Edit")}</span>
                                  ) : Math.abs(s.drift) < 1 ? (
                                    <span className="text-[#8f8676]">{tr("On target — hold")}</span>
                                  ) : s.rebalanceUsd > 0 ? (
                                    <span className="text-emerald-700">
                                      {tr("Buy {v}", { v: formatUsd(s.rebalanceUsd) })} ≈ {s.rebalanceShares.toFixed(1)} {tr("sh")}
                                    </span>
                                  ) : (
                                    <span className="text-rose-700">
                                      {tr("Trim {v}", { v: formatUsd(-s.rebalanceUsd) })} ≈ {(-s.rebalanceShares).toFixed(1)} {tr("sh")}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[#8f8676]">{tr("Industry")}</p>
                                <p className="text-[#1f1c17]">
                                  {h.industry && h.industry !== "—" ? h.industry : tr("Unclassified")}
                                </p>
                              </div>
                              <div>
                                <p className="text-[11px] text-[#8f8676]">{tr("Research")}</p>
                                <p className="flex gap-3">
                                  <a
                                    href={`https://finance.yahoo.com/quote/${encodeURIComponent(h.ticker)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-[#3b352d] underline decoration-black/20 underline-offset-2 hover:text-[#1f1c17]"
                                  >
                                    Yahoo ↗
                                  </a>
                                  <a
                                    href={`https://finviz.com/quote.ashx?t=${encodeURIComponent(h.ticker)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-[#3b352d] underline decoration-black/20 underline-offset-2 hover:text-[#1f1c17]"
                                  >
                                    Finviz ↗
                                  </a>
                                </p>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            {holdings.length > 0 && !isFiltered ? (
              <tfoot>
                <tr className="border-t-2 border-black/15 bg-[#f6f3ea] text-sm font-semibold text-[#1f1c17]">
                  <td className="px-2 py-2.5" />
                  <td className="px-2 py-2.5">{tr("Total")}</td>
                  <td className="px-2 py-2.5 text-xs font-normal text-[#6f675b]">
                    {tr("{n} positions · cost {v}", { n: holdings.length, v: formatUsd(totals.totalCost) })}
                  </td>
                  <td
                    className={`px-2 py-2.5 ${Math.abs(totals.totalTarget - 100) > 0.5 && totals.totalTarget > 0 ? "text-amber-700" : ""}`}
                    title={Math.abs(totals.totalTarget - 100) > 0.5 ? tr("Targets should add up to 100%") : undefined}
                  >
                    {formatPercent(totals.totalTarget)}
                  </td>
                  <td className="px-2 py-2.5">{formatPercent(totals.totalCurrent)}</td>
                  <td className="px-2 py-2.5" colSpan={3} />
                  <td className="whitespace-nowrap px-2 py-2.5">
                    {totals.hasQuotes ? (
                      <>
                        <span className={toneClass(totals.dayUsd)}>{signedUsd(totals.dayUsd)}</span>
                        <span className={`block text-[11px] font-normal ${toneClass(totals.dayPct)}`}>
                          {signedPct(totals.dayPct, 2)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2.5">{formatUsd(totals.totalValue)}</td>
                  <td className="whitespace-nowrap px-2 py-2.5">
                    <span className={toneClass(totals.totalPnl)}>{signedUsd(totals.totalPnl)}</span>
                    <span className={`block text-[11px] font-normal ${toneClass(totals.totalPnlPct)}`}>
                      {signedPct(totals.totalPnlPct)}
                    </span>
                  </td>
                  {mode === "edit" ? <td className="px-2 py-2.5" /> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
    </div>
  );
}
