"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatUsd, parseUsd } from "@/features/investing/format";
import { useSnapshots, type Period } from "@/features/investing/watchlist/data";
import { DetailsPanel } from "@/features/investing/watchlist/details-panel";
import { DipFinder } from "@/features/investing/watchlist/dip-finder";
import { buySignal, num, RangeBar, signedPct, SignalPill, type Signal } from "@/features/investing/watchlist/signals";
import { TickerLogo } from "@/features/investing/watchlist/ticker-logo";
import {
  investingMetaBadge,
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useInvesting, type InvestingPickingRow } from "@/state/investing-store";

/** Bucket rules: target share of the portfolio and maximum number of positions. */
const BUCKETS = [
  { key: "etf_reit_fund", title: "ETF / REIT / Fund", target: 40, max: 5 },
  { key: "value_blue_chips", title: "Value / Blue chips", target: 40, max: 10 },
] as const;
type BucketKey = (typeof BUCKETS)[number]["key"];
const BUCKET_TITLE: Record<string, string> = Object.fromEntries(BUCKETS.map((b) => [b.key, b.title]));

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

function inputBaseClasses() {
  return "w-full min-w-[4.5rem] rounded-lg border border-black/10 bg-white/90 px-2 py-1 text-sm text-[#2f2922] outline-none placeholder:text-[#b0a79a] focus:border-black/20 focus:bg-white";
}

/** Editable columns only (market fields come from quotes). */
const BASE_EDIT_KEYS = ["name", "ticker", "industry", "pe", "eps", "beta", "div_yield"] as const;
const ZONE_PRICE_KEYS = ["strong_buy_until", "may_buy_until"] as const;
const GOAL_KEYS = ["price_goal_1y", "price_goal_5y"] as const;

export default function InvestingPickingPage() {
  const { token } = useAuth();
  const {
    pickingRows,
    pickingMeta,
    isPickingLoading,
    isPickingSaving,
    isPickingDirty,
    addPickingRow,
    updatePickingRow,
    deletePickingRow,
    savePicking,
    refreshPicking,
    holdings,
  } = useInvesting();
  const tr = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isAutofilling, setAutofilling] = useState(false);
  const [autofillMsg, setAutofillMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isPickingDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isPickingDirty]);

  // ---- Portfolio context: weight per ticker and how holdings fill each bucket ----
  const portfolio = useMemo(() => {
    const total = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const weight = new Map<string, number>();
    for (const h of holdings) {
      const t = h.ticker.trim().toUpperCase();
      if (t) weight.set(t, (weight.get(t) ?? 0) + (total > 0 ? (parseUsd(h.marketValue) / total) * 100 : 0));
    }
    const ruleBucket = new Map(pickingRows.map((r) => [r.ticker.trim().toUpperCase(), r.bucket] as const));
    const byBucket = new Map<string, { pct: number; tickers: string[] }>();
    for (const h of holdings) {
      const t = h.ticker.trim().toUpperCase();
      if (!t) continue;
      // A rule row decides the bucket; otherwise funds go to ETF / REIT / Fund and other stocks are unassigned.
      const key =
        ruleBucket.get(t) ?? ((h.industry ?? "").trim().toUpperCase().startsWith("ETF") ? "etf_reit_fund" : "unassigned");
      const cur = byBucket.get(key) ?? { pct: 0, tickers: [] };
      cur.pct += weight.get(t) ?? 0;
      if (!cur.tickers.includes(t)) cur.tickers.push(t);
      byBucket.set(key, cur);
    }
    return { weight, byBucket };
  }, [holdings, pickingRows]);

  // ---- Watchlist market data (view mode only, so typing a ticker in Edit doesn't refetch per key) ----
  const tickers = useMemo(() => [...new Set(pickingRows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean))], [pickingRows]);
  const { snapshots, loading: snapshotsLoading } = useSnapshots(mode === "view" ? tickers : [], token);

  // Rows not saved yet have no quote from the server; the snapshot's price fills in until they are.
  const pricedRows = useMemo(
    () =>
      pickingRows.map((r) => {
        const snap = snapshots[r.ticker.trim().toUpperCase()];
        if (r.current_price || snap?.price == null) return r;
        return { ...r, current_price: snap.price.toFixed(2), day_change_pct: snap.change_pct != null ? `${snap.change_pct}%` : "" };
      }),
    [pickingRows, snapshots],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, { row: InvestingPickingRow; signal: Signal; distance: number }[]>();
    for (const row of pricedRows) {
      const key = BUCKETS.some((b) => b.key === row.bucket) ? row.bucket : "value_blue_chips";
      const signal = buySignal(row, tr);
      const px = num(row.current_price);
      const next = Number.isFinite(num(row.may_buy_until)) ? num(row.may_buy_until) : num(row.strong_buy_until);
      const distance = Number.isFinite(px) && Number.isFinite(next) ? px / next - 1 : Infinity;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push({ row, signal, distance });
    }
    for (const list of groups.values()) {
      list.sort((a, b) =>
        mode === "edit"
          ? a.row.ticker.localeCompare(b.row.ticker)
          : a.signal.rank - b.signal.rank || a.distance - b.distance,
      );
    }
    return BUCKETS.map((b) => ({ bucket: b, items: groups.get(b.key) ?? [] }));
  }, [pricedRows, mode, tr]);

  const readyToBuy = useMemo(
    () => grouped.flatMap((g) => g.items).filter((i) => i.signal.rank <= 1),
    [grouped],
  );

  async function autofill() {
    if (!token) return;
    const tickers = [...new Set(pickingRows.map((r) => r.ticker.trim().toUpperCase()).filter(Boolean))];
    if (tickers.length === 0) return;
    setAutofilling(true);
    setAutofillMsg(null);
    try {
      const q = encodeURIComponent(tickers.join(","));
      const [prof, fund] = await Promise.all([
        apiFetch<{ profiles: Record<string, { name: string; industry: string; pe: string; eps: string }> }>(
          `/investing/profiles?tickers=${q}`,
          { token },
        ),
        apiFetch<{ fundamentals: Record<string, { beta: number | null; div_yield_percent: number | null }> }>(
          `/investing/fundamentals?tickers=${q}`,
          { token },
        ),
      ]);
      const filled: string[] = [];
      for (const row of pickingRows) {
        const t = row.ticker.trim().toUpperCase();
        const p = prof.profiles?.[t];
        const f = fund.fundamentals?.[t];
        // Only empty fields are filled, so values the user typed are never overwritten.
        const patch: Partial<InvestingPickingRow> = {};
        if (!row.name.trim() && p?.name) patch.name = p.name;
        if (!row.industry.trim() && p?.industry) patch.industry = p.industry;
        if (!row.pe.trim() && p?.pe) patch.pe = p.pe;
        if (!row.eps.trim() && p?.eps) patch.eps = p.eps;
        if (!row.beta.trim() && f?.beta != null) patch.beta = f.beta.toFixed(2);
        if (!row.div_yield.trim() && f?.div_yield_percent != null) patch.div_yield = f.div_yield_percent.toFixed(2);
        if (Object.keys(patch).length) {
          updatePickingRow(row.id, patch);
          filled.push(t);
        }
      }
      setAutofillMsg(
        filled.length ? tr("Filled {list} — review and press Save.", { list: filled.join(", ") }) : tr("Nothing to fill: every field already has a value."),
      );
    } catch {
      setAutofillMsg(tr("Autofill failed — try again."));
    } finally {
      setAutofilling(false);
    }
  }

  const unassigned = portfolio.byBucket.get("unassigned");

  const [period, setPeriod] = useState<Period>("YTD");
  const [selected, setSelected] = useState<string | null>(null);
  const flat = grouped.flatMap((g) => g.items);
  const current = flat.find((i) => i.row.ticker.trim().toUpperCase() === selected) ?? flat.find((i) => i.row.ticker.trim()) ?? null;
  const currentTicker = current?.row.ticker.trim().toUpperCase() ?? null;

  // Holdings that aren't on the watchlist yet: one click adds them (funds go to ETF / REIT / Fund).
  const missingHoldings = useMemo(() => {
    const listed = new Set(tickers);
    const seen = new Set<string>();
    return holdings.filter((h) => {
      const t = h.ticker.trim().toUpperCase();
      if (!t || listed.has(t) || seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  }, [holdings, tickers]);
  function addHoldings() {
    addPickingRow(
      missingHoldings.map((h) => {
        const ticker = h.ticker.trim().toUpperCase();
        const industry = (h.industry ?? "").trim();
        const name = (h.name ?? "").trim();
        return {
          ticker,
          name: name.toUpperCase() === ticker ? "" : name,
          industry: industry === "—" ? "" : industry,
          bucket: industry.toUpperCase().startsWith("ETF") ? "etf_reit_fund" : "value_blue_chips",
        };
      }),
    );
  }

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        {tr("Stocks you follow, with your buy zones. The Dip Finder shows what fell the most, each stock shows whether today’s price is in your strong-buy or may-buy zone, and each bucket shows how your portfolio compares with its target.")}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={investingMetaBadge}>
            {pickingMeta.updatedAt ? tr("Synced {when}", { when: new Date(pickingMeta.updatedAt).toLocaleString(locale) }) : tr("Not synced")}
          </span>
          <button
            type="button"
            onClick={() => void refreshPicking()}
            disabled={isPickingLoading}
            className={`${investingToolbarBtn} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {isPickingLoading ? tr("Loading…") : tr("Refresh quotes")}
          </button>
          {missingHoldings.length ? (
            <button
              type="button"
              onClick={addHoldings}
              title={missingHoldings.map((h) => h.ticker.trim().toUpperCase()).join(", ")}
              className={investingToolbarBtn}
            >
              {tr("Add holdings ({n})", { n: missingHoldings.length })}
            </button>
          ) : null}
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
              <button type="button" onClick={() => addPickingRow()} className={investingToolbarBtn}>
                {tr("Add row")}
              </button>
              <button
                type="button"
                onClick={() => void autofill()}
                disabled={isAutofilling}
                title={tr("Fill empty name, industry, P/E, EPS, beta and yield from Finviz")}
                className={isAutofilling ? investingPrimarySaveDisabled : investingToolbarBtn}
              >
                {isAutofilling ? tr("Looking up…") : tr("Autofill fundamentals")}
              </button>
              <button
                type="button"
                onClick={() => void savePicking()}
                disabled={!isPickingDirty || isPickingSaving || isPickingLoading}
                className={!isPickingDirty || isPickingSaving || isPickingLoading ? investingPrimarySaveDisabled : investingPrimarySaveActive}
              >
                {isPickingSaving ? tr("Saving…") : tr("Save")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {isPickingDirty ? (
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
      {autofillMsg ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-black/10 bg-[#faf8f2] px-4 py-3 text-sm text-[#3b352d]">
          <p>{autofillMsg}</p>
          <button type="button" onClick={() => setAutofillMsg(null)} className="text-xs opacity-70 hover:opacity-100">
            {tr("Dismiss")}
          </button>
        </div>
      ) : null}

      {/* Bucket health */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3 [&>*]:min-w-0">
        {BUCKETS.map((b) => {
          const actual = portfolio.byBucket.get(b.key) ?? { pct: 0, tickers: [] };
          const count = actual.tickers.length;
          const gap = actual.pct - b.target;
          const status =
            count > b.max
              ? { text: `⚠ ${tr("{n} over the {max}-position limit", { n: count - b.max, max: b.max })}`, cls: "text-amber-800" }
              : Math.abs(gap) > 5
                ? {
                    text: `${gap > 0 ? "▲" : "▼"} ${tr(gap > 0 ? "{v} pp above target" : "{v} pp below target", { v: Math.abs(gap).toFixed(1) })}`,
                    cls: "text-[#6f675b]",
                  }
                : { text: `✓ ${tr("Close to target")}`, cls: "text-emerald-800" };
          return (
            <article key={b.key} className={card}>
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#1f1c17]">{tr(b.title)}</h2>
                <span className="text-xs text-[#8f8676]">
                  {tr("target {t}% · max {max}", { t: b.target, max: b.max })}
                </span>
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-[#1f1c17]">{actual.pct.toFixed(1)}%</p>
              <div className="relative mt-2 h-2 rounded-full bg-black/5" aria-hidden>
                <div className="h-2 rounded-full bg-[#2a78d6]" style={{ width: `${Math.min(100, actual.pct)}%` }} />
                <div className="absolute -top-1 h-4 w-0.5 bg-[#1f1c17]" style={{ left: `${b.target}%` }} title={tr("Target {v}%", { v: b.target })} />
              </div>
              <p className={`mt-2 text-xs font-medium ${status.cls}`}>{status.text}</p>
              <p className="mt-1 text-xs text-[#6f675b]">
                {tr("{n} of {max} positions", { n: count, max: b.max })}
                {count ? `: ${actual.tickers.join(", ")}` : ""}
              </p>
            </article>
          );
        })}
        <article className={card}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Not in a bucket")}</h2>
            <span className="text-xs text-[#8f8676]">{tr("stocks you hold")}</span>
          </div>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[#1f1c17]">{(unassigned?.pct ?? 0).toFixed(1)}%</p>
          <p className="mt-2 text-xs text-[#6f675b]">
            {unassigned?.tickers.length
              ? tr("{list} — add them as rows in Edit to assign a bucket.", { list: unassigned.tickers.join(", ") })
              : tr("Every holding belongs to a bucket.")}
          </p>
          <p className="mt-1 text-[11px] text-[#8f8676]">{tr("Funds (industry “ETF …”) count as ETF / REIT / Fund automatically.")}</p>
        </article>
      </section>

      {mode === "view" && readyToBuy.length > 0 ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900">
          <p className="font-semibold">{tr("In your buy zone now")}</p>
          <p className="mt-1">
            {readyToBuy.map((i) => `${i.row.ticker} (${i.signal.label.toLowerCase()}, ${formatUsd(num(i.row.current_price))})`).join(" · ")}
          </p>
        </section>
      ) : null}

      {mode === "view" && pickingRows.length === 0 ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`}>
          {tr("No stocks yet — switch to Edit, add a row with a ticker and your buy prices, then Autofill.")}
        </p>
      ) : mode === "view" ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px] [&>*]:min-w-0">
          <div className="space-y-4">
            <DipFinder
              bars={tickers.map((t) => ({ ticker: t, value: snapshots[t]?.perf[period] }))}
              period={period}
              onPeriod={setPeriod}
              selected={currentTicker}
              onSelect={setSelected}
              loading={snapshotsLoading}
            />
            <section className="overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
              <div className="flex items-baseline gap-2 px-5 py-4">
                <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Stocks")}</h2>
                <span className="rounded-full bg-[#f4efe4] px-2 py-0.5 text-[11px] font-medium text-[#6f675b]">{pickingRows.length}</span>
                <span className="ml-auto text-[11px] text-[#8f8676]">{tr("best opportunities first")}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] border-collapse text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-[#8f8676]">
                    <tr className="border-t border-black/5">
                      <th className="px-5 py-2 font-medium">{tr("Stock")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Price")}</th>
                      <th className="px-3 py-2 text-right font-medium">{tr("Today")}</th>
                      <th className="px-3 py-2 font-medium">{tr("Signal")}</th>
                      <th className="px-5 py-2 font-medium">{tr("52-week")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped.map(({ bucket, items }) =>
                      items.length === 0 ? null : (
                        <Fragment key={bucket.key}>
                          <tr className="border-t border-black/10 bg-[#f4efe4]/70">
                            <td colSpan={5} className="px-5 py-1.5 text-xs font-semibold text-[#1f1c17]">
                              {tr(bucket.title)} <span className="font-normal text-[#6f675b]">· {tr("{n} on the list", { n: items.length })}</span>
                            </td>
                          </tr>
                          {items.map(({ row, signal }) => {
                            const t = row.ticker.trim().toUpperCase();
                            const px = num(row.current_price);
                            const day = num(row.day_change_pct);
                            const own = portfolio.weight.get(t);
                            const snap = snapshots[t];
                            const active = current?.row.id === row.id;
                            return (
                              <tr
                                key={row.id}
                                onClick={() => setSelected(t)}
                                className={`cursor-pointer border-t border-black/5 ${active ? "bg-[#eef4fc]" : "hover:bg-[#faf8f2]"}`}
                              >
                                <td className="px-5 py-2.5">
                                  <button type="button" onClick={() => setSelected(t)} className="flex items-center gap-3 text-left" aria-pressed={active}>
                                    <TickerLogo ticker={t} size={32} />
                                    <span className="min-w-0">
                                      <span className="block font-semibold text-[#1f1c17]">{row.ticker || "—"}</span>
                                      <span className="block max-w-[180px] truncate text-[11px] text-[#8f8676]">{(row.name.trim().toUpperCase() !== t && row.name.trim()) || snap?.name || row.industry || "—"}</span>
                                    </span>
                                  </button>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-[#1f1c17]">
                                  {Number.isFinite(px) ? formatUsd(px) : "—"}
                                  {own != null ? (
                                    <span className="block text-[11px] font-normal text-[#8f8676]">
                                      {tr("You own")} {own.toFixed(1)}%
                                    </span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  <span
                                    className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${day > 0 ? "bg-emerald-50 text-emerald-700" : day < 0 ? "bg-rose-50 text-rose-700" : "text-[#8f8676]"}`}
                                  >
                                    {Number.isFinite(day) ? signedPct(day, 1) : "—"}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5">
                                  <SignalPill signal={signal} />
                                  {/* How far from the zone; hints like "add buy prices" live in the details panel. */}
                                  {signal.rank <= 3 ? <span className="block whitespace-nowrap pt-0.5 text-[11px] text-[#8f8676]">{signal.detail}</span> : null}
                                </td>
                                <td className="px-5 py-2.5">
                                  <RangeBar low={snap?.low_52w} high={snap?.high_52w} price={px} strong={num(row.strong_buy_until)} may={num(row.may_buy_until)} />
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-black/5 px-5 py-2 text-[11px] text-[#8f8676]">
                {tr("52-week bar: green = your strong-buy zone, amber = may-buy zone, dot = today’s price.")}
              </p>
            </section>
          </div>
          <div className="h-fit xl:sticky xl:top-[72px]">
            {current ? (
              <DetailsPanel
                row={current.row}
                snapshot={currentTicker ? snapshots[currentTicker] : undefined}
                signal={current.signal}
                own={currentTicker ? portfolio.weight.get(currentTicker) : undefined}
                token={token}
                onEdit={() => setMode("edit")}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className={investingTableScrollWrap}>
          <table className="w-full min-w-[1700px] border-collapse text-left text-sm">
            <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
              <tr>
                <th className="px-2 py-2 font-medium">{tr("Bucket")}</th>
                <th className="px-2 py-2 font-medium">{tr("Name")}</th>
                <th className="px-2 py-2 font-medium">{tr("Ticker")}</th>
                <th className="px-2 py-2 font-medium">{tr("Industry")}</th>
                <th className="px-2 py-2 font-medium">P/E</th>
                <th className="px-2 py-2 font-medium">EPS</th>
                <th className="px-2 py-2 font-medium">{tr("Beta")}</th>
                <th className="px-2 py-2 font-medium">{tr("Div yield %")}</th>
                <th className="px-2 py-2 font-medium">{tr("Strong buy until")}</th>
                <th className="px-2 py-2 font-medium">{tr("May buy until")}</th>
                <th className="px-2 py-2 font-medium">{tr("Signal override")}</th>
                <th className="px-2 py-2 font-medium">{tr("Price goal 1y")}</th>
                <th className="px-2 py-2 font-medium">{tr("Price goal 5y")}</th>
                <th className="min-w-[220px] px-2 py-2 font-medium">{tr("Notes")}</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {grouped.flatMap(({ items }) => items).map(({ row }) => (
                <tr key={row.id} className="border-t border-black/5 align-top">
                  <td className="px-2 py-2">
                    <select
                      value={BUCKETS.some((b) => b.key === row.bucket) ? row.bucket : "value_blue_chips"}
                      onChange={(e) => updatePickingRow(row.id, { bucket: e.target.value as BucketKey })}
                      className={inputBaseClasses()}
                    >
                      {BUCKETS.map((b) => (
                        <option key={b.key} value={b.key}>
                          {tr(BUCKET_TITLE[b.key])}
                        </option>
                      ))}
                    </select>
                  </td>
                  {BASE_EDIT_KEYS.map((key) => (
                    <td key={key} className="px-2 py-2">
                      <input
                        value={row[key] ?? ""}
                        onChange={(e) =>
                          updatePickingRow(row.id, { [key]: key === "ticker" ? e.target.value.toUpperCase() : e.target.value })
                        }
                        className={inputBaseClasses()}
                      />
                    </td>
                  ))}
                  {ZONE_PRICE_KEYS.map((key) => (
                    <td key={key} className="px-2 py-2">
                      <input
                        value={row[key] ?? ""}
                        onChange={(e) => updatePickingRow(row.id, { [key]: e.target.value })}
                        className={inputBaseClasses()}
                        inputMode="decimal"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <input
                      value={row.buy_right_now ?? ""}
                      onChange={(e) => updatePickingRow(row.id, { buy_right_now: e.target.value })}
                      placeholder={tr("Auto from zones")}
                      className={inputBaseClasses()}
                    />
                  </td>
                  {GOAL_KEYS.map((key) => (
                    <td key={key} className="px-2 py-2">
                      <input
                        value={row[key] ?? ""}
                        onChange={(e) => updatePickingRow(row.id, { [key]: e.target.value })}
                        className={inputBaseClasses()}
                        inputMode="decimal"
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <textarea
                      value={row.notes ?? ""}
                      onChange={(e) => updatePickingRow(row.id, { notes: e.target.value })}
                      rows={2}
                      className={[inputBaseClasses(), "min-h-[2.75rem] resize-y"].join(" ")}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => deletePickingRow(row.id)} className={investingToolbarBtn}>
                      {tr("Delete")}
                    </button>
                  </td>
                </tr>
              ))}
              {pickingRows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-3 py-4 text-center text-xs text-[#8f8676]">
                    {tr("No rows yet — Add row.")}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {mode === "edit" ? (
        <p className="-mt-2 text-[11px] text-[#8f8676]">
          {tr("Signal is automatic: price ≤ strong-buy → Strong buy, ≤ may-buy → May buy, otherwise Wait. Type in Signal override only to replace it with your own note. Autofill only fills empty fields.")}
        </p>
      ) : null}
    </div>
  );
}
