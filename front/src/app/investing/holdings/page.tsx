"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { formatPercent, formatUsd, parsePercent, parseUsd } from "@/features/investing/format";
import {
  investingMetaBadge,
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
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
  } = useInvesting();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});
  const [sortBy, setSortBy] = useState<SortKey>("ticker");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<
    { ok: true; summary: InvestingHoldingsImportSummary } | { ok: false; message: string } | null
  >(null);

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

  const totals = useMemo(() => {
    const totalValue = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const totalTarget = holdings.reduce((a, h) => a + parsePercent(h.targetWeight), 0);
    const totalCurrent = holdings.reduce((a, h) => a + parsePercent(h.currentWeight), 0);
    return { totalValue, totalTarget, totalCurrent };
  }, [holdings]);

  const sortedHoldings = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...holdings].sort((a, b) => {
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
  }, [holdings, sortBy, sortDir]);

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

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        Day % is today&apos;s session move from market data — use Refresh market.
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs text-[#6f675b]">
          <span className={investingMetaBadge}>Total value {formatUsd(totals.totalValue)}</span>
          <span className={investingMetaBadge}>Target sum {formatPercent(totals.totalTarget)}</span>
          <span className={investingMetaBadge}>Current sum {formatPercent(totals.totalCurrent)}</span>
          <span className={investingMetaBadge}>
            Source {holdingsMeta.source}
            {holdingsMeta.updatedAt ? ` · synced ${new Date(holdingsMeta.updatedAt).toLocaleString()}` : ""}
          </span>
          <span className={investingMetaBadge}>Div Yield {isMetricsLoading ? "…" : metrics.divYieldPercent}</span>
          <span className={investingMetaBadge}>Beta {isMetricsLoading ? "…" : metrics.beta}</span>
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
            {isMarketPricesLoading ? "Refreshing…" : "Refresh market"}
          </button>
          <button
            onClick={() => void refreshMetrics().catch(() => {})}
            disabled={isMetricsLoading}
            className={[
              "transition",
              isMetricsLoading ? investingPrimarySaveDisabled : investingToolbarBtn,
            ].join(" ")}
          >
            {isMetricsLoading ? "Refreshing metrics…" : "Refresh metrics"}
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
            title="Columns: Ticker, Qty, Entry Price, Price, Value"
            className={["transition", isImporting ? investingPrimarySaveDisabled : investingToolbarBtn].join(" ")}
          >
            {isImporting ? "Importing…" : "Import XLSX"}
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
              View
            </button>
            <button
              type="button"
              onClick={() => setMode("edit")}
              className={[
                "rounded-full px-3 py-1.5 text-xs font-medium transition",
                mode === "edit" ? "bg-[#f3efe5] text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2]",
              ].join(" ")}
            >
              Edit
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
                {isHoldingsSaving ? "Saving…" : "Save"}
              </button>
              <button onClick={addHolding} className={investingPrimarySaveActive}>
                Add row
              </button>
              <button onClick={reset} className={investingToolbarBtn}>
                Reset
              </button>
            </>
          ) : null}
        </div>
      </div>

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
                Imported: {importResult.summary.updated.length} updated, {importResult.summary.added.length} added.
                Review and press Save to store in the database.
              </p>
              {importResult.summary.added.length > 0 ? (
                <p>New: {importResult.summary.added.join(", ")} — set name, target and industry.</p>
              ) : null}
              {importResult.summary.notInFile.length > 0 ? (
                <p>Not in file (kept, delete if sold): {importResult.summary.notInFile.join(", ")}</p>
              ) : null}
              {importResult.summary.skipped.length > 0 ? (
                <p>Skipped (missing Qty or Entry Price): {importResult.summary.skipped.join(", ")}</p>
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

      <div className="overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-left tabular-nums">
            <thead className="sticky top-0 z-10 bg-[#f4efe4] text-xs text-[#7f7668]">
            <tr>
              <th className="w-[52px] px-2 py-2 font-medium" />
              <th className="w-[88px] px-2 py-2 font-medium">
                <button type="button" onClick={() => toggleSort("ticker")} className="inline-flex items-center gap-1">
                  Ticker <span>{sortArrow("ticker")}</span>
                </button>
              </th>
              <th className="w-[180px] px-2 py-2 text-left font-medium">Name</th>
              <th className="w-[80px] px-2 py-2 text-left font-medium">
                <button type="button" onClick={() => toggleSort("targetWeight")} className="inline-flex items-center gap-1">
                  Target <span>{sortArrow("targetWeight")}</span>
                </button>
              </th>
              <th className="w-[80px] px-2 py-2 text-left font-medium">
                <button type="button" onClick={() => toggleSort("currentWeight")} className="inline-flex items-center gap-1">
                  Current <span>{sortArrow("currentWeight")}</span>
                </button>
              </th>
              <th className="w-[62px] px-2 py-2 text-left font-medium">
                <button type="button" onClick={() => toggleSort("shares")} className="inline-flex items-center gap-1">
                  Shares <span>{sortArrow("shares")}</span>
                </button>
              </th>
              <th className="w-[90px] px-2 py-2 text-left font-medium">
                <button type="button" onClick={() => toggleSort("avgBuyPrice")} className="inline-flex items-center gap-1">
                  Avg buy <span>{sortArrow("avgBuyPrice")}</span>
                </button>
              </th>
              <th className="w-[90px] px-2 py-2 text-left font-medium">
                <button type="button" onClick={() => toggleSort("marketPrice")} className="inline-flex items-center gap-1">
                  Market <span>{sortArrow("marketPrice")}</span>
                </button>
              </th>
              <th className="w-[76px] px-2 py-2 text-left font-medium">
                <button
                  type="button"
                  onClick={() => toggleSort("dayChangePercent")}
                  className="inline-flex items-center gap-1"
                >
                  Day % <span>{sortArrow("dayChangePercent")}</span>
                </button>
              </th>
              <th className="w-[94px] px-2 py-2 text-left font-medium">
                <button type="button" onClick={() => toggleSort("marketValue")} className="inline-flex items-center gap-1">
                  Value <span>{sortArrow("marketValue")}</span>
                </button>
              </th>
              <th className="w-[110px] px-2 py-2 font-medium">
                <button type="button" onClick={() => toggleSort("pnl")} className="inline-flex items-center gap-1">
                  P&L <span>{sortArrow("pnl")}</span>
                </button>
              </th>
              {mode === "edit" ? <th className="w-[88px] px-2 py-2 font-medium">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.map((h) => (
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
                        placeholder="Company name"
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
                        inputMode="numeric"
                        placeholder="0"
                      />
                    </td>
                    <td className="px-2 py-2 text-left">
                      <input
                        value={h.avgBuyPrice}
                        onChange={(e) => updateHolding(h.id, { avgBuyPrice: e.target.value })}
                        onBlur={() =>
                          updateHolding(h.id, { avgBuyPrice: formatUsd(parseUsd(h.avgBuyPrice)) })
                        }
                        className={`${inputBaseClasses()} text-left tabular-nums`}
                        inputMode="decimal"
                        placeholder="$0.00"
                      />
                    </td>
                    <td className="px-2 py-2 text-left">
                      <input
                        value={h.marketPrice}
                        onChange={(e) => updateHolding(h.id, { marketPrice: e.target.value })}
                        onBlur={() =>
                          updateHolding(h.id, { marketPrice: formatUsd(parseUsd(h.marketPrice)) })
                        }
                        className={`${inputBaseClasses()} text-left tabular-nums`}
                        inputMode="decimal"
                        placeholder="$0.00"
                      />
                    </td>
                    <td className="px-2 py-2 text-left">
                      <div
                        title="Session change from quotes (Yahoo). Refresh market to update."
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
                        onBlur={() =>
                          updateHolding(h.id, { marketValue: formatUsd(parseUsd(h.marketValue)) })
                        }
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
                    {mode === "edit" ? (
                      <td className="px-2 py-2">
                        <button
                          onClick={() => deleteHolding(h.id)}
                          className={investingToolbarBtn}
                          type="button"
                        >
                          Delete
                        </button>
                      </td>
                    ) : null}
                  </>
                ) : (
                  <>
                    <td className="px-2 py-2 text-center text-sm text-[#8f8676]">
                      {expandedRowIds[h.id] ? "−" : "+"}
                    </td>
                    <td className="px-2 py-2 text-sm font-semibold text-[#2f2922]">{h.ticker}</td>
                    <td className="px-2 py-2 text-sm text-[#2f2922]">{h.name}</td>
                    <td className="px-2 py-2 text-left text-sm tabular-nums text-[#2f2922] whitespace-nowrap">
                      {formatPercent(parsePercent(h.targetWeight))}
                    </td>
                    <td className="px-2 py-2 text-left text-sm tabular-nums text-[#2f2922] whitespace-nowrap">
                      {formatPercent(parsePercent(h.currentWeight))}
                    </td>
                    <td className="px-2 py-2 text-left text-sm tabular-nums text-[#2f2922] whitespace-nowrap">
                      {h.shares}
                    </td>
                    <td className="px-2 py-2 text-left text-sm tabular-nums text-[#2f2922] whitespace-nowrap">
                      {formatUsd(parseUsd(h.avgBuyPrice))}
                    </td>
                    <td className="px-2 py-2 text-left text-sm tabular-nums text-[#2f2922] whitespace-nowrap">
                      {formatUsd(parseUsd(h.marketPrice))}
                    </td>
                    <td
                      className={[
                        "px-2 py-2 text-left text-sm font-semibold tabular-nums whitespace-nowrap",
                        dayChangeCellClass(h.dayChangePercent),
                      ].join(" ")}
                      title="Session change from quotes. Refresh market to update."
                    >
                      {h.dayChangePercent ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-left text-sm tabular-nums text-[#2f2922] whitespace-nowrap">
                      {formatUsd(parseUsd(h.marketValue))}
                    </td>
                    <td className="px-2 py-2 text-left">
                      <span
                        className={[
                          "inline-flex min-w-[96px] justify-start rounded-full border border-black/10 bg-[#faf8f2] px-2.5 py-1 text-xs font-semibold tabular-nums whitespace-nowrap",
                          parseUsd(h.pnl) >= 0 ? "text-emerald-700" : "text-rose-700",
                        ].join(" ")}
                      >
                        {formatUsd(parseUsd(h.pnl))}
                      </span>
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
                            Industry
                            <input
                              value={h.industry}
                              onChange={(e) => updateHolding(h.id, { industry: e.target.value })}
                              className={`${inputBaseClasses()} mt-1`}
                              placeholder="ETF / Tech / ..."
                            />
                          </label>
                        </div>
                      ) : (
                        <div className="grid gap-1">
                          <p className="text-xs text-[#8f8676]">
                            <span className="font-medium text-[#655d51]">Industry:</span> {h.industry}
                          </p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
