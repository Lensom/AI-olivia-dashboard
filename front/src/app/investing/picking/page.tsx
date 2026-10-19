"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { formatUsd, parseUsd } from "@/features/investing/format";
import {
  investingMetaBadge,
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
  investingTableScrollWrap,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { apiFetch } from "@/lib/api";
import { useLocale, useT, type T } from "@/lib/i18n";
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

function num(s: string | undefined): number {
  const raw = String(s ?? "").trim();
  if (!raw) return NaN;
  const n = parseUsd(raw);
  return Number.isFinite(n) && /\d/.test(raw) ? n : NaN;
}

function signedPct(n: number, digits = 1): string {
  return Number.isFinite(n) ? `${n > 0 ? "+" : ""}${n.toFixed(digits)}%` : "—";
}

type Signal = { rank: number; label: string; detail: string; cls: string; icon: string };

/** Where the price sits against the user's buy zones; rank sorts the best opportunities first. */
function buySignal(row: InvestingPickingRow, t: T): Signal {
  const override = row.buy_right_now.trim();
  if (override) return { rank: 2, label: override, detail: t("Manual note"), cls: "bg-[#f4efe4] text-[#3b352d]", icon: "✎" };
  const px = num(row.current_price);
  const strong = num(row.strong_buy_until);
  const may = num(row.may_buy_until);
  if (!Number.isFinite(px)) return { rank: 5, label: t("No price"), detail: t("Refresh quotes"), cls: "bg-[#f4efe4] text-[#8f8676]", icon: "…" };
  if (Number.isFinite(strong) && px <= strong)
    return { rank: 0, label: t("Strong buy"), detail: `${signedPct((px / strong - 1) * 100)} ${t("vs")} ${formatUsd(strong)}`, cls: "bg-emerald-50 text-emerald-800", icon: "▼" };
  if (Number.isFinite(may) && px <= may)
    return { rank: 1, label: t("May buy"), detail: `${signedPct((px / may - 1) * 100)} ${t("vs")} ${formatUsd(may)}`, cls: "bg-amber-50 text-amber-800", icon: "◐" };
  const next = Number.isFinite(may) ? may : strong;
  if (!Number.isFinite(next)) return { rank: 4, label: t("No zone set"), detail: t("Add buy prices in Edit"), cls: "bg-[#f4efe4] text-[#8f8676]", icon: "–" };
  return { rank: 3, label: t("Wait"), detail: t("needs {pct} to {v}", { pct: signedPct((next / px - 1) * 100), v: formatUsd(next) }), cls: "bg-rose-50 text-rose-800", icon: "■" };
}

/** Price track: green = strong-buy zone, amber = may-buy zone, dot = current price. */
function ZoneBar({ row }: { row: InvestingPickingRow }) {
  const t = useT();
  const px = num(row.current_price);
  const strong = num(row.strong_buy_until);
  const may = num(row.may_buy_until);
  const levels = [px, strong, may].filter(Number.isFinite);
  if (!Number.isFinite(px) || levels.length < 2) return <span className="text-xs text-[#b0a79a]">—</span>;
  const lo = Math.min(...levels) * 0.85;
  const hi = Math.max(...levels) * 1.08;
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div
      className="relative h-2.5 w-36 rounded-full bg-black/5"
      title={`${t("Strong")} ≤ ${Number.isFinite(strong) ? formatUsd(strong) : "—"} · ${t("May")} ≤ ${Number.isFinite(may) ? formatUsd(may) : "—"} · ${t("Now")} ${formatUsd(px)}`}
    >
      {Number.isFinite(strong) ? <div className="absolute inset-y-0 left-0 rounded-l-full bg-emerald-400/80" style={{ width: x(strong) }} /> : null}
      {Number.isFinite(may) ? (
        <div
          className="absolute inset-y-0 bg-amber-300/80"
          style={{ left: Number.isFinite(strong) ? x(strong) : "0%", width: `calc(${x(may)} - ${Number.isFinite(strong) ? x(strong) : "0%"})` }}
        />
      ) : null}
      <div className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#1f1c17]" style={{ left: x(px) }} />
    </div>
  );
}

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

  const grouped = useMemo(() => {
    const groups = new Map<string, { row: InvestingPickingRow; signal: Signal; distance: number }[]>();
    for (const row of pickingRows) {
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
  }, [pickingRows, mode, tr]);

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

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        {tr("Your buckets and buy zones. Each stock shows whether today’s price is in your strong-buy or may-buy zone, and each bucket shows how your portfolio compares with its target.")}
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
              <button type="button" onClick={addPickingRow} className={investingToolbarBtn}>
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

      {mode === "view" ? (
        <div className={investingTableScrollWrap}>
          <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
            <thead className="bg-[#f4efe4] text-xs text-[#7f7668]">
              <tr>
                <th className="px-3 py-2 font-medium">{tr("Stock")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Price")}</th>
                <th className="px-3 py-2 font-medium">{tr("Signal")}</th>
                <th className="px-3 py-2 font-medium">{tr("Buy zones")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("Upside 1y / 5y")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("P/E · Beta · Yield")}</th>
                <th className="px-3 py-2 text-right font-medium">{tr("You own")}</th>
                <th className="px-3 py-2 font-medium">{tr("Notes")}</th>
              </tr>
            </thead>
            <tbody>
              {pickingRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-[#8f8676]">
                    {tr("No stocks yet — switch to Edit, add a row with a ticker and your buy prices, then Autofill.")}
                  </td>
                </tr>
              ) : null}
              {grouped.map(({ bucket, items }) =>
                items.length === 0 ? null : (
                  <Fragment key={bucket.key}>
                    <tr className="border-t border-black/10 bg-[#ebe6dc]">
                      <td colSpan={8} className="px-3 py-2 text-xs font-semibold text-[#1f1c17]">
                        {tr(bucket.title)} <span className="font-normal text-[#6f675b]">· {tr("{n} on the list", { n: items.length })}</span>
                      </td>
                    </tr>
                    {items.map(({ row, signal }) => {
                      const px = num(row.current_price);
                      const day = num(row.day_change_pct);
                      const own = portfolio.weight.get(row.ticker.trim().toUpperCase());
                      return (
                        <tr key={row.id} className="border-t border-black/5 align-top hover:bg-[#faf8f2]">
                          <td className="px-3 py-2.5">
                            <span className="font-semibold text-[#1f1c17]">{row.ticker || "—"}</span>
                            <span className="block max-w-[220px] truncate text-[11px] text-[#8f8676]" title={`${row.name} · ${row.industry}`}>
                              {[row.name, row.industry].filter((v) => v.trim()).join(" · ") || "—"}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                            <span className="text-[#1f1c17]">{Number.isFinite(px) ? formatUsd(px) : "—"}</span>
                            <span className={`block text-[11px] ${day > 0 ? "text-emerald-700" : day < 0 ? "text-rose-700" : "text-[#8f8676]"}`}>
                              {Number.isFinite(day) ? signedPct(day, 2) : ""}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${signal.cls}`}>
                              <span aria-hidden>{signal.icon}</span>
                              {signal.label}
                            </span>
                            <span className="block pt-0.5 text-[11px] text-[#8f8676]">{signal.detail}</span>
                          </td>
                          <td className="px-3 py-3">
                            <ZoneBar row={row} />
                            <span className="block pt-1 text-[11px] tabular-nums text-[#8f8676]">
                              ≤{row.strong_buy_until || "—"} {tr("strong")} · ≤{row.may_buy_until || "—"} {tr("may")}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#3b352d]">
                            {signedPct((num(row.price_goal_1y) / px - 1) * 100, 0)} / {signedPct((num(row.price_goal_5y) / px - 1) * 100, 0)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#3b352d]">
                            {row.pe || "—"} · {row.beta || "—"} · {row.div_yield ? `${row.div_yield}%` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#3b352d]">
                            {own != null ? `${own.toFixed(1)}%` : <span className="text-[#b0a79a]">—</span>}
                          </td>
                          <td className="max-w-[240px] px-3 py-2.5 text-xs text-[#6f675b]">
                            <span className="line-clamp-2" title={row.notes}>
                              {row.notes || "—"}
                            </span>
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
