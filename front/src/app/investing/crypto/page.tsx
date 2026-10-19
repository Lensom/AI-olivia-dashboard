"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatCryptoUsd } from "@/features/investing/crypto-format";
import { buildCoinPositions, buildCryptoTotals, rebalancingSplit, ruleBtcShare } from "@/features/investing/crypto-stats";
import { investingMetaBadge, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useCrypto } from "@/state/crypto-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[#1f1c17]";
  return n > 0 ? "text-emerald-700" : "text-rose-700";
}
const signedUsd = (n: number) => `${n > 0 ? "+" : ""}${formatCryptoUsd(n)}`;
const signedPct = (n: number | null, d = 1) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(d)}%`);

function Kpi({ label, value, valueTone, sub }: { label: string; value: string; valueTone?: string; sub?: React.ReactNode }) {
  const t = useT();
  return (
    <article className={card}>
      <p className="text-xs text-[#7f7668]">{t(label)}</p>
      <p className={`mt-1.5 text-xl font-semibold tabular-nums ${valueTone ?? "text-[#1f1c17]"}`}>{value}</p>
      {sub ? <div className="mt-1 text-xs text-[#6f675b]">{sub}</div> : null}
    </article>
  );
}

export default function CryptoOverviewPage() {
  const { holdings, purchaseRows, refillRows, rules, cryptoMeta, isCryptoLoading, refreshCrypto } = useCrypto();
  const tr = useT();
  const locale = useLocale();
  const coins = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 8 });

  const positions = useMemo(() => buildCoinPositions(holdings, purchaseRows), [holdings, purchaseRows]);
  const totals = useMemo(() => buildCryptoTotals(positions, refillRows, purchaseRows), [positions, refillRows, purchaseRows]);
  const hasQuotes = positions.some((p) => p.price != null);

  const btcShare = ruleBtcShare(rules);
  const btcValue = positions.find((p) => p.symbol === "BTC")?.value ?? 0;
  const ethValue = positions.find((p) => p.symbol === "ETH")?.value ?? 0;
  const pair = btcValue + ethValue;
  const actualBtc = pair > 0 ? btcValue / pair : 0;
  const nextSplit = rebalancingSplit(100, btcValue, ethValue, btcShare);

  return (
    <div className="space-y-5">
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
          {isCryptoLoading ? tr("Loading…") : tr("Refresh prices")}
        </button>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Portfolio value"
          value={formatCryptoUsd(totals.value)}
          sub={
            hasQuotes ? (
              <span className={tone(totals.dayUsd)}>
                {tr("{v} today", { v: `${signedUsd(totals.dayUsd)} (${signedPct(totals.dayPct, 2)})` })}
              </span>
            ) : (
              tr("Waiting for prices")
            )
          }
        />
        <Kpi
          label="Total return"
          value={signedUsd(totals.pnl)}
          valueTone={tone(totals.pnl)}
          sub={
            <>
              <span className={`font-semibold ${tone(totals.pnlPct)}`}>{signedPct(totals.pnlPct)}</span>{" "}
              {tr("on {v} funded", { v: formatCryptoUsd(totals.funded) })}
            </>
          }
        />
        <Kpi
          label="Spent on coins"
          value={formatCryptoUsd(totals.spent)}
          sub={tr("{n} purchase days", { n: purchaseRows.length })}
        />
        <Kpi
          label="Lost to fees / spread"
          value={formatCryptoUsd(Math.max(0, totals.notSpent))}
          sub={
            totals.funded > 0
              ? tr("{v}% of funding never reached a coin", { v: ((Math.max(0, totals.notSpent) / totals.funded) * 100).toFixed(2) })
              : tr("Add funding rows")
          }
        />
      </section>

      {/* Per coin */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        {positions.length === 0 ? (
          <article className={`${card} text-sm text-[#655d51]`}>
            {tr("No coins yet — add them on Portfolio.")}{" "}
            <Link href="/investing/crypto/holdings" className="underline">
              {tr("Portfolio")} →
            </Link>
          </article>
        ) : null}
        {positions.map((p) => {
          const held = p.quantity;
          const bought = p.history?.coins ?? null;
          const mismatch = bought != null && held > 0 && Math.abs(bought - held) / held > 0.02;
          return (
            <article key={p.id} className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-[#1f1c17]">
                  {p.symbol} <span className="text-sm font-normal text-[#8f8676]">{p.name !== p.symbol ? p.name : ""}</span>
                </h2>
                <span className="text-xs text-[#8f8676]">{tr("{v}% of crypto", { v: p.weight.toFixed(1) })}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] text-[#8f8676]">{tr("Value")}</p>
                  <p className="font-semibold tabular-nums text-[#1f1c17]">{formatCryptoUsd(p.value)}</p>
                  <p className="text-[11px] tabular-nums text-[#8f8676]">{tr("{v} coins", { v: coins(held) })}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#8f8676]">{tr("Price now")}</p>
                  <p className="font-semibold tabular-nums text-[#1f1c17]">{p.price != null ? formatCryptoUsd(p.price) : "—"}</p>
                  <p className={`text-[11px] tabular-nums ${p.dayPct == null ? "text-[#8f8676]" : tone(p.dayPct)}`}>
                    {tr("{v} today", { v: signedPct(p.dayPct, 2) })}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#8f8676]">{tr("Your average buy")}</p>
                  <p className="font-semibold tabular-nums text-[#1f1c17]">
                    {p.history?.avgPrice != null ? formatCryptoUsd(p.history.avgPrice) : "—"}
                  </p>
                  <p className="text-[11px] text-[#8f8676]">{p.history ? tr("{n} buys", { n: p.history.buys }) : tr("No purchase history")}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#8f8676]">{tr("Profit / loss")}</p>
                  <p className={`font-semibold tabular-nums ${tone(p.pnl)}`}>{p.pnl != null ? signedUsd(p.pnl) : "—"}</p>
                  <p className={`text-[11px] tabular-nums ${tone(p.pnlPct)}`}>{signedPct(p.pnlPct)}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-[11px] text-[#8f8676]">{tr("Price vs your average")}</p>
                  {p.priceVsAvgPct != null ? (
                    <p className="text-sm text-[#3b352d]">
                      <span className={`font-semibold ${p.priceVsAvgPct < 0 ? "text-emerald-700" : "text-[#1f1c17]"}`}>
                        {signedPct(p.priceVsAvgPct)}
                      </span>{" "}
                      {p.priceVsAvgPct < 0 ? tr("— cheaper than you usually paid") : tr("— above what you usually paid")}
                    </p>
                  ) : (
                    <p className="text-sm text-[#8f8676]">—</p>
                  )}
                </div>
              </div>
              {mismatch ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  ⚠{" "}
                  {tr("History adds up to {bought} {symbol}, but you hold {held}. A purchase may be missing, or the difference is fees / transfers — P&L uses the coins you hold.", {
                    bought: coins(bought!),
                    symbol: p.symbol,
                    held: coins(held),
                  })}
                </p>
              ) : null}
            </article>
          );
        })}
      </section>

      {/* Split vs rule */}
      {pair > 0 ? (
        <article className={card}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("BTC / ETH split vs your rule")}</h2>
            <Link href="/investing/crypto/rules" className="text-xs text-[#6f675b] underline decoration-black/15 underline-offset-2">
              {tr("Edit rule")}
            </Link>
          </div>
          <div className="mt-3 space-y-2 text-xs text-[#6f675b]">
            {[
              { label: "Now", btc: actualBtc },
              { label: "Rule", btc: btcShare },
            ].map((row) => (
              <div key={row.label} className="grid grid-cols-[44px_1fr_auto] items-center gap-3">
                <span>{tr(row.label)}</span>
                <div className="flex h-3 overflow-hidden rounded-full bg-black/5">
                  <div className="h-3 bg-[#eda100]" style={{ width: `${row.btc * 100}%` }} title={`BTC ${(row.btc * 100).toFixed(1)}%`} />
                  <div className="h-3 bg-[#6250d6]" style={{ width: `${(1 - row.btc) * 100}%` }} title={`ETH ${((1 - row.btc) * 100).toFixed(1)}%`} />
                </div>
                <span className="whitespace-nowrap tabular-nums">
                  BTC {(row.btc * 100).toFixed(1)}% · ETH {((1 - row.btc) * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-[#3b352d]">
            {Math.abs(actualBtc - btcShare) < 0.02
              ? `✓ ${tr("On target.")}`
              : tr("{coin} is over-weight by {pp} pp.", { coin: actualBtc > btcShare ? "BTC" : "ETH", pp: (Math.abs(actualBtc - btcShare) * 100).toFixed(1) })}{" "}
            {tr("To move toward the rule, a $100 deposit would go")}{" "}
            <span className="font-semibold tabular-nums">
              {formatCryptoUsd(nextSplit.btc)} BTC / {formatCryptoUsd(nextSplit.eth)} ETH
            </span>
            .
          </p>
          <p className="mt-1 flex gap-4 text-[11px] text-[#8f8676]">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#eda100]" />
              BTC
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#6250d6]" />
              ETH
            </span>
          </p>
        </article>
      ) : null}

      <p className="text-[11px] text-[#8f8676]">
        {tr("Total return compares today’s value with the USD that arrived from funding, so fees and exchange spread count against it. Profit / loss per coin uses your average buy price from purchase history.")}
      </p>
    </div>
  );
}
