"use client";

import { useEffect, useMemo, useState } from "react";
import { formatCryptoUsd, parseCryptoAmount } from "@/features/investing/crypto-format";
import { coinHistory } from "@/features/investing/crypto-stats";
import {
  investingMetaBadge,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingSubsectionStack,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { InvestingSubsectionHeader } from "@/features/investing/ui/investing-subsection-header";
import { useLocale, useT } from "@/lib/i18n";
import { useCrypto } from "@/state/crypto-store";
import { cryptoInputClasses } from "../_inputs";

const th = "px-2 py-2.5 align-middle text-xs font-medium text-[#7f7668]";
const tdMid = "px-2 py-2 align-middle";
const tdCalc = "px-3 py-2 align-middle text-right text-sm tabular-nums text-[#6f675b]";
const inputNum = `${cryptoInputClasses()} text-center tabular-nums`;
const inputDate = `${cryptoInputClasses()} text-center`;

const coins = (n: number) => (n > 0 ? n.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "—");

export default function CryptoLedgerPage() {
  const {
    purchaseRows,
    refillRows,
    cryptoMeta,
    isCryptoLoading,
    isCryptoSaving,
    isCryptoDirty,
    updatePurchase,
    addPurchase,
    deletePurchase,
    updateRefill,
    addRefill,
    deleteRefill,
    saveCrypto,
    refreshCrypto,
  } = useCrypto();
  const tr = useT();
  const locale = useLocale();

  const [purchOpen, setPurchOpen] = useState(true);
  const [refillOpen, setRefillOpen] = useState(true);

  useEffect(() => {
    if (!isCryptoDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isCryptoDirty]);

  // USD spent on coins per date, to compare each funding row with what it bought.
  const spentByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of purchaseRows) {
      const d = r.date.trim();
      m.set(d, (m.get(d) ?? 0) + parseCryptoAmount(r.btc_usd) + parseCryptoAmount(r.eth_usd));
    }
    return m;
  }, [purchaseRows]);

  const summary = useMemo(() => {
    const uah = refillRows.reduce((a, r) => a + parseCryptoAmount(r.uah), 0);
    const usd = refillRows.reduce((a, r) => a + parseCryptoAmount(r.usd), 0);
    const btc = coinHistory(purchaseRows, "BTC");
    const eth = coinHistory(purchaseRows, "ETH");
    return { uah, usd, rate: usd > 0 ? uah / usd : null, btc, eth, spent: btc.spent + eth.spent };
  }, [refillRows, purchaseRows]);

  return (
    <div className="space-y-6">
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
          {isCryptoLoading ? "…" : tr("Reload")}
        </button>
        <button
          type="button"
          onClick={() => void saveCrypto()}
          disabled={!isCryptoDirty || isCryptoSaving || isCryptoLoading}
          className={!isCryptoDirty || isCryptoSaving || isCryptoLoading ? investingPrimarySaveDisabled : investingPrimarySaveActive}
        >
          {isCryptoSaving ? tr("Saving…") : tr("Save")}
        </button>
      </div>

      {isCryptoDirty ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          <span aria-hidden>●</span> {tr("Unsaved changes — press Save to keep them.")}
        </div>
      ) : null}

      <section className="flex flex-wrap gap-x-8 gap-y-3 rounded-2xl border border-black/5 bg-white/90 px-5 py-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        {[
          { label: "Funded", value: formatCryptoUsd(summary.usd), sub: `${summary.uah.toLocaleString(locale, { maximumFractionDigits: 2 })} UAH` },
          { label: "Average rate", value: summary.rate ? `${summary.rate.toFixed(2)} UAH/$` : "—", sub: tr("UAH ÷ USD across funding") },
          { label: "Spent on BTC", value: formatCryptoUsd(summary.btc.spent), sub: `${coins(summary.btc.coins)} BTC` },
          { label: "Spent on ETH", value: formatCryptoUsd(summary.eth.spent), sub: `${coins(summary.eth.coins)} ETH` },
          {
            label: "Funded − spent",
            value: formatCryptoUsd(summary.usd - summary.spent),
            sub: tr("Fees / spread or unused cash"),
          },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[11px] text-[#8f8676]">{tr(s.label)}</p>
            <p className="text-base font-semibold tabular-nums text-[#1f1c17]">{s.value}</p>
            <p className="text-[11px] text-[#8f8676]">{s.sub}</p>
          </div>
        ))}
      </section>

      <section className={investingSubsectionStack}>
        <InvestingSubsectionHeader title="Funding: UAH → USD" isOpen={refillOpen} onToggle={() => setRefillOpen((v) => !v)} />
        {refillOpen ? (
          <>
            <p className="text-xs text-[#655d51]">
              {tr("Date, UAH paid and USD received. Rate and “Spent” are calculated; Spent is what the purchases on the same date used.")}
            </p>
            <div className={investingTableScrollWrap}>
              <table className="w-full min-w-[780px] border-collapse text-sm">
                <thead className="bg-[#f4efe4]">
                  <tr>
                    <th className={`${th} text-center`}>{tr("Date")}</th>
                    <th className={`${th} text-center`}>UAH</th>
                    <th className={`${th} text-center`}>USD</th>
                    <th className={`${th} text-right`}>{tr("Rate, UAH/$")}</th>
                    <th className={`${th} text-right`}>{tr("Spent on coins")}</th>
                    <th className={`${th} text-right`}>{tr("Difference")}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {refillRows.map((row) => {
                    const uah = parseCryptoAmount(row.uah);
                    const usd = parseCryptoAmount(row.usd);
                    const spent = spentByDate.get(row.date.trim()) ?? 0;
                    const diff = usd - spent;
                    return (
                      <tr key={row.id} className="border-t border-black/5">
                        <td className={tdMid}>
                          <input value={row.date} onChange={(e) => updateRefill(row.id, { date: e.target.value })} className={inputDate} placeholder="DD.MM.YYYY" />
                        </td>
                        <td className={tdMid}>
                          <input value={row.uah} onChange={(e) => updateRefill(row.id, { uah: e.target.value })} className={inputNum} placeholder="5340" inputMode="decimal" />
                        </td>
                        <td className={tdMid}>
                          <input value={row.usd} onChange={(e) => updateRefill(row.id, { usd: e.target.value })} className={inputNum} placeholder="125.08" inputMode="decimal" />
                        </td>
                        <td className={tdCalc}>{uah > 0 && usd > 0 ? (uah / usd).toFixed(2) : "—"}</td>
                        <td className={tdCalc}>{spent > 0 ? formatCryptoUsd(spent) : "—"}</td>
                        <td className={`${tdCalc} ${spent > 0 && Math.abs(diff) > 0.005 ? "text-[#1f1c17]" : ""}`}>
                          {spent > 0 ? formatCryptoUsd(diff) : "—"}
                        </td>
                        <td className={`${tdMid} text-right`}>
                          <button type="button" onClick={() => deleteRefill(row.id)} className={investingToolbarBtn}>
                            {tr("Delete")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {refillRows.length > 0 ? (
                    <tr className="border-t-2 border-black/15 bg-[#f6f3ea] font-semibold text-[#1f1c17]">
                      <td className="px-3 py-2">{tr("Total")}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{summary.uah.toLocaleString(locale, { maximumFractionDigits: 2 })}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatCryptoUsd(summary.usd)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{summary.rate ? summary.rate.toFixed(2) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCryptoUsd(summary.spent)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCryptoUsd(summary.usd - summary.spent)}</td>
                      <td />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={addRefill} className={investingToolbarBtn}>
              {tr("Add funding row")}
            </button>
          </>
        ) : null}
      </section>

      <section className={investingSubsectionStack}>
        <InvestingSubsectionHeader title="BTC / ETH purchases" isOpen={purchOpen} onToggle={() => setPurchOpen((v) => !v)} />
        {purchOpen ? (
          <>
            <p className="text-xs text-[#655d51]">
              {tr("Per date: USD spent and the execution price. Leave a coin empty if you only bought the other. Coins bought are calculated (USD ÷ price).")}
            </p>
            <div className={investingTableScrollWrap}>
              <table className="w-full min-w-[1040px] border-collapse text-sm">
                <thead className="bg-[#f4efe4]">
                  <tr>
                    <th className={`${th} text-center`}>{tr("Date")}</th>
                    <th className={`${th} text-center`}>BTC, $</th>
                    <th className={`${th} text-center`}>{tr("BTC price")}</th>
                    <th className={`${th} text-right`}>{tr("BTC bought")}</th>
                    <th className={`${th} text-center`}>ETH, $</th>
                    <th className={`${th} text-center`}>{tr("ETH price")}</th>
                    <th className={`${th} text-right`}>{tr("ETH bought")}</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {purchaseRows.map((row) => {
                    const btc = parseCryptoAmount(row.btc_price) > 0 ? parseCryptoAmount(row.btc_usd) / parseCryptoAmount(row.btc_price) : 0;
                    const eth = parseCryptoAmount(row.eth_price) > 0 ? parseCryptoAmount(row.eth_usd) / parseCryptoAmount(row.eth_price) : 0;
                    return (
                      <tr key={row.id} className="border-t border-black/5">
                        <td className={tdMid}>
                          <input value={row.date} onChange={(e) => updatePurchase(row.id, { date: e.target.value })} className={inputDate} placeholder="DD.MM.YYYY" />
                        </td>
                        <td className={tdMid}>
                          <input value={row.btc_usd} onChange={(e) => updatePurchase(row.id, { btc_usd: e.target.value })} className={inputNum} inputMode="decimal" />
                        </td>
                        <td className={tdMid}>
                          <input value={row.btc_price} onChange={(e) => updatePurchase(row.id, { btc_price: e.target.value })} className={inputNum} inputMode="decimal" />
                        </td>
                        <td className={tdCalc}>{coins(btc)}</td>
                        <td className={tdMid}>
                          <input value={row.eth_usd} onChange={(e) => updatePurchase(row.id, { eth_usd: e.target.value })} className={inputNum} inputMode="decimal" />
                        </td>
                        <td className={tdMid}>
                          <input value={row.eth_price} onChange={(e) => updatePurchase(row.id, { eth_price: e.target.value })} className={inputNum} inputMode="decimal" />
                        </td>
                        <td className={tdCalc}>{coins(eth)}</td>
                        <td className={`${tdMid} text-right`}>
                          <button type="button" onClick={() => deletePurchase(row.id)} className={investingToolbarBtn}>
                            {tr("Delete")}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {purchaseRows.length > 0 ? (
                    <tr className="border-t-2 border-black/15 bg-[#f6f3ea] font-semibold text-[#1f1c17]">
                      <td className="px-3 py-2">{tr("Total / avg")}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatCryptoUsd(summary.btc.spent)}</td>
                      <td className="px-3 py-2 text-center tabular-nums" title={tr("Average buy price")}>
                        {summary.btc.avgPrice != null ? formatCryptoUsd(summary.btc.avgPrice) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{coins(summary.btc.coins)}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{formatCryptoUsd(summary.eth.spent)}</td>
                      <td className="px-3 py-2 text-center tabular-nums" title={tr("Average buy price")}>
                        {summary.eth.avgPrice != null ? formatCryptoUsd(summary.eth.avgPrice) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{coins(summary.eth.coins)}</td>
                      <td />
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={addPurchase} className={investingToolbarBtn}>
              {tr("Add purchase row")}
            </button>
          </>
        ) : null}
      </section>
    </div>
  );
}
