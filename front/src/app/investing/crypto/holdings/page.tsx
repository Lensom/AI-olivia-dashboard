"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCryptoUsd } from "@/features/investing/crypto-format";
import { buildCoinPositions } from "@/features/investing/crypto-stats";
import {
  investingMetaBadge,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useCrypto } from "@/state/crypto-store";
import { cryptoInputClasses } from "../_inputs";

function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[#6f675b]";
  return n > 0 ? "text-emerald-700" : "text-rose-700";
}
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatCryptoUsd(n)}`;
const signedPct = (n: number | null, d = 1) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

const th = "px-3 py-2.5 align-middle text-xs font-medium text-[#7f7668]";
const td = "px-3 py-2.5 align-middle tabular-nums";
const inputLeft = `${cryptoInputClasses()} text-left`;

export default function CryptoHoldingsPage() {
  const {
    holdings,
    purchaseRows,
    cryptoMeta,
    isCryptoLoading,
    isCryptoSaving,
    isCryptoDirty,
    updateHolding,
    addHolding,
    deleteHolding,
    saveCrypto,
    refreshCrypto,
  } = useCrypto();
  const tr = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<"view" | "edit">("view");

  useEffect(() => {
    if (!isCryptoDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isCryptoDirty]);

  const positions = useMemo(() => buildCoinPositions(holdings, purchaseRows), [holdings, purchaseRows]);
  const totals = useMemo(() => {
    const value = positions.reduce((a, p) => a + p.value, 0);
    const dayUsd = positions.reduce((a, p) => a + (p.dayUsd ?? 0), 0);
    const withCost = positions.filter((p) => p.cost != null && p.pnl != null);
    const cost = withCost.reduce((a, p) => a + p.cost!, 0);
    const pnl = withCost.reduce((a, p) => a + p.pnl!, 0);
    return { value, dayUsd, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null };
  }, [positions]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={investingMetaBadge}>
            {cryptoMeta.updatedAt ? tr("Synced {when}", { when: new Date(cryptoMeta.updatedAt).toLocaleString(locale) }) : tr("Not synced")}
          </span>
          <button
            type="button"
            onClick={() => void refreshCrypto()}
            disabled={isCryptoLoading}
            className={`${investingToolbarBtn} disabled:opacity-50`}
          >
            {isCryptoLoading ? "…" : tr("Refresh prices")}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
                {m === "view" ? tr("View") : tr("Edit")}
              </button>
            ))}
          </div>
          {mode === "edit" ? (
            <>
              <button type="button" onClick={addHolding} className={investingToolbarBtn}>
                {tr("Add coin")}
              </button>
              <button
                type="button"
                onClick={() => void saveCrypto()}
                disabled={!isCryptoDirty || isCryptoSaving || isCryptoLoading}
                className={!isCryptoDirty || isCryptoSaving || isCryptoLoading ? investingPrimarySaveDisabled : investingPrimarySaveActive}
              >
                {isCryptoSaving ? tr("Saving…") : tr("Save")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isCryptoDirty ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span>
            <span aria-hidden>●</span> {tr("Unsaved changes — press Save to keep them.")}
          </span>
          {mode === "view" ? (
            <button type="button" onClick={() => setMode("edit")} className={investingToolbarBtn}>
              {tr("Go to Edit")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className={investingTableScrollWrap}>
        {mode === "view" ? (
          <table className="w-full min-w-[860px] border-collapse text-sm">
            <thead className="bg-[#f4efe4]">
              <tr>
                <th className={`${th} text-left`}>{tr("Coin")}</th>
                <th className={`${th} text-right`}>{tr("Quantity")}</th>
                <th className={`${th} text-right`}>{tr("Price")}</th>
                <th className={`${th} text-right`}>{tr("Day")}</th>
                <th className={`${th} text-right`}>{tr("Value")}</th>
                <th className={`${th} text-right`}>{tr("Weight")}</th>
                <th className={`${th} text-right`}>{tr("Avg buy")}</th>
                <th className={`${th} text-right`}>{tr("P&L")}</th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-[#8f8676]">
                    {tr("No coins yet — switch to Edit and add BTC or ETH.")}
                  </td>
                </tr>
              ) : null}
              {positions.map((p) => (
                <tr key={p.id} className="border-t border-black/5 hover:bg-[#faf8f2]">
                  <td className={`${td} text-left`}>
                    <span className="font-semibold text-[#1f1c17]">{p.symbol}</span>
                    {p.name && p.name !== p.symbol ? <span className="block text-[11px] text-[#8f8676]">{p.name}</span> : null}
                  </td>
                  <td className={`${td} text-right text-[#3b352d]`}>{p.quantity.toLocaleString(locale, { maximumFractionDigits: 8 })}</td>
                  <td className={`${td} text-right text-[#3b352d]`}>{p.price != null ? formatCryptoUsd(p.price) : "—"}</td>
                  <td className={`${td} text-right`}>
                    <span className={`font-semibold ${tone(p.dayPct)}`}>{signedPct(p.dayPct, 2)}</span>
                    {p.dayUsd != null ? <span className="block text-[11px] text-[#8f8676]">{signedUsd(p.dayUsd)}</span> : null}
                  </td>
                  <td className={`${td} text-right font-medium text-[#1f1c17]`}>{formatCryptoUsd(p.value)}</td>
                  <td className={`${td} text-right text-[#3b352d]`}>{p.weight.toFixed(1)}%</td>
                  <td className={`${td} text-right text-[#3b352d]`}>
                    {p.history?.avgPrice != null ? formatCryptoUsd(p.history.avgPrice) : "—"}
                    {p.priceVsAvgPct != null ? (
                      <span className="block text-[11px] text-[#8f8676]">{tr("price {v}", { v: signedPct(p.priceVsAvgPct) })}</span>
                    ) : null}
                  </td>
                  <td className={`${td} text-right`}>
                    <span className={`font-semibold ${tone(p.pnl)}`}>{p.pnl != null ? signedUsd(p.pnl) : "—"}</span>
                    <span className={`block text-[11px] ${tone(p.pnlPct)}`}>{signedPct(p.pnlPct)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {positions.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-black/15 bg-[#f6f3ea] font-semibold">
                  <td className={`${td} text-left text-[#1f1c17]`} colSpan={3}>
                    {tr("Total")}
                  </td>
                  <td className={`${td} text-right ${tone(totals.dayUsd)}`}>{signedUsd(totals.dayUsd)}</td>
                  <td className={`${td} text-right text-[#1f1c17]`}>{formatCryptoUsd(totals.value)}</td>
                  <td className={`${td} text-right`}>100%</td>
                  <td className={td} />
                  <td className={`${td} text-right`}>
                    <span className={tone(totals.pnl)}>{signedUsd(totals.pnl)}</span>
                    <span className={`block text-[11px] font-normal ${tone(totals.pnlPct)}`}>{signedPct(totals.pnlPct)}</span>
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        ) : (
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-[#f4efe4]">
              <tr>
                <th className={`${th} text-left`}>{tr("Ticker")}</th>
                <th className={`${th} text-left`}>{tr("Name")}</th>
                <th className={`${th} text-left`}>{tr("Quantity")}</th>
                <th className={`${th} text-right`}>{tr("Price")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {holdings.map((row) => (
                <tr key={row.id} className="border-t border-black/5">
                  <td className="px-2 py-2">
                    <input
                      value={row.symbol}
                      onChange={(e) => updateHolding(row.id, { symbol: e.target.value.toUpperCase() })}
                      className={`${inputLeft} uppercase`}
                      placeholder="BTC"
                    />
                  </td>
                  <td className="px-2 py-2">
                    <input value={row.name} onChange={(e) => updateHolding(row.id, { name: e.target.value })} className={inputLeft} placeholder="Bitcoin" />
                  </td>
                  <td className="px-2 py-2">
                    <input
                      value={row.quantity}
                      onChange={(e) => updateHolding(row.id, { quantity: e.target.value })}
                      className={`${inputLeft} tabular-nums`}
                      placeholder="0.00233"
                      inputMode="decimal"
                    />
                  </td>
                  <td className={`${td} text-right text-[#6f675b]`}>{row.quoteUsd ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <button type="button" onClick={() => deleteHolding(row.id)} className={investingToolbarBtn}>
                      {tr("Delete")}
                    </button>
                  </td>
                </tr>
              ))}
              {holdings.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-xs text-[#8f8676]">
                    {tr("No coins — Add coin. Prices use the TICKER-USD pair automatically.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-[#8f8676]">
        {tr("Avg buy and P&L come from BTC / ETH purchases on Funding & buys. Other coins show value only.")}
      </p>
    </div>
  );
}
