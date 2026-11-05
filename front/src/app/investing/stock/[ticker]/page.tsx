"use client";

import { useRouter } from "next/navigation";
import { use, useMemo, useState } from "react";
import { AiReview } from "@/features/investing/stock/ai-review";
import { BarChart, PriceChart, SERIES_BLUE, SERIES_ORANGE, type PriceMark } from "@/features/investing/stock/charts";
import {
  compactCount,
  compactMoney,
  priceText,
  useStockDetail,
  useStockFit,
  type Estimate,
  type Financials,
  type StockDetail,
} from "@/features/investing/stock/data";
import { CHART_RANGES, consensusLabel, useChart, type ChartRange } from "@/features/investing/watchlist/data";
import { News } from "@/features/investing/watchlist/details-panel";
import { signedPct } from "@/features/investing/watchlist/signals";
import { TickerLogo } from "@/features/investing/watchlist/ticker-logo";
import { investingPageStack, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const cardTitle = "text-sm font-semibold text-[#1f1c17]";

function Segmented<V extends string>({ options, value, onChange, label }: { options: { value: V; label: string }[]; value: V; onChange: (v: V) => void; label: string }) {
  return (
    <div className="flex rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={o.value === value}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${o.value === value ? "bg-[#1f1c17] text-white" : "text-[#6f675b] hover:bg-[#faf8f2]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const utcDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

function useDayText() {
  const locale = useLocale();
  return (iso: string) => utcDate(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function Header({ d }: { d: StockDetail }) {
  const t = useT();
  const dayText = useDayText();
  const pct = d.change_pct;
  const tone = pct == null ? "bg-[#f4efe4] text-[#6f675b]" : pct >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700";
  return (
    <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
      <div className="flex min-w-0 items-center gap-4">
        <TickerLogo ticker={d.ticker} size={56} />
        <div className="min-w-0">
          <h2 className="truncate text-xl font-semibold text-[#1f1c17]" title={d.name || d.ticker}>{d.name || d.ticker}</h2>
          <p className="truncate text-xs text-[#8f8676]">{[d.ticker, d.exchange, d.profile.sector].filter(Boolean).join(" · ")}</p>
          <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-[#6f675b]">
            <a href={`https://finviz.com/quote.ashx?t=${encodeURIComponent(d.ticker)}`} target="_blank" rel="noreferrer" className="font-medium text-[#2a78d6] hover:underline">Finviz ↗</a>
            <a href={`https://finance.yahoo.com/quote/${encodeURIComponent(d.ticker)}`} target="_blank" rel="noreferrer" className="font-medium text-[#2a78d6] hover:underline">Yahoo ↗</a>
          </p>
        </div>
      </div>
      <div className="text-right max-sm:text-left">
        <p className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="text-3xl font-semibold tabular-nums text-[#1f1c17]">{priceText(d.price, d.currency)}</span>
          {pct != null ? (
            <span className={`rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${tone}`}>
              {d.change != null ? `${d.change > 0 ? "+" : ""}${d.change.toFixed(2)} · ` : ""}
              {signedPct(pct, 2)}
            </span>
          ) : null}
        </p>
        <p className="mt-1.5 text-xs text-[#6f675b]">
          {d.earnings_date ? (
            <span>
              {t("Earnings")}: <span className="font-medium text-[#1f1c17]">{dayText(d.earnings_date)}</span>
              {d.earnings_date_estimated ? ` (${t("estimate")})` : ""}
            </span>
          ) : null}
          {d.earnings_date && d.ex_dividend_date ? " · " : ""}
          {d.ex_dividend_date ? (
            <span>
              {t("Ex-dividend")}: <span className="font-medium text-[#1f1c17]">{dayText(d.ex_dividend_date)}</span>
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}

function StatGroup({ title, rows }: { title: string; rows: [string, string | null][] }) {
  const present = rows.filter((r): r is [string, string] => r[1] != null);
  if (!present.length) return null;
  return (
    <div className="min-w-0">
      <h3 className={cardTitle}>{title}</h3>
      <dl className="mt-2">
        {present.map(([name, value]) => (
          <div key={name} className="flex items-baseline justify-between gap-3 border-t border-black/5 py-1.5">
            <dt className="text-xs text-[#6f675b]">{name}</dt>
            <dd className="text-xs font-semibold tabular-nums text-[#1f1c17]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function KeyStats({ d }: { d: StockDetail }) {
  const t = useT();
  const s = d.stats;
  const cur = d.financial_currency;
  const ratio = (v: number | null) => (v != null ? v.toFixed(2) : null);
  const pct = (v: number | null) => (v != null ? `${v.toFixed(2)}%` : null);
  const growth = (v: number | null) => (v != null ? signedPct(v, 2) : null);
  const money = (v: number | null) => (v != null ? compactMoney(v, cur) : null);
  return (
    <section className={`${card} grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5`} aria-label={t("Key statistics")}>
      <StatGroup
        title={t("Valuation")}
        rows={[
          [d.is_fund ? t("Assets (AUM)") : t("Market cap"), s.market_cap != null ? compactMoney(s.market_cap, d.currency) : null],
          ["P/E", ratio(s.pe)],
          [t("Forward P/E"), ratio(s.forward_pe)],
          ["PEG", ratio(s.peg)],
          ["P/S", ratio(s.price_to_sales)],
          ["P/B", ratio(s.price_to_book)],
          ["EV/EBITDA", ratio(s.ev_ebitda)],
        ]}
      />
      <StatGroup
        title={t("Cash flow")}
        rows={[
          [t("Free cash flow, 12 months"), money(s.fcf_ttm)],
          [t("Free cash flow yield"), pct(s.fcf_yield)],
          [t("Stock compensation, 12 months"), money(s.sbc_ttm)],
          [t("Yield after stock compensation"), pct(s.fcf_yield_after_sbc)],
        ]}
      />
      <StatGroup
        title={t("Margins & growth")}
        rows={[
          [t("Gross margin"), pct(s.gross_margin)],
          [t("Operating margin"), pct(s.operating_margin)],
          [t("Profit margin"), pct(s.profit_margin)],
          [t("Quarterly revenue (YoY)"), growth(s.revenue_growth)],
          [t("Quarterly earnings (YoY)"), growth(s.earnings_growth)],
        ]}
      />
      <StatGroup
        title={t("Balance")}
        rows={[
          [t("Cash"), money(s.cash)],
          [t("Debt"), money(s.debt)],
          [t("Net"), money(s.net_cash)],
        ]}
      />
      <StatGroup
        title={d.is_fund ? t("Fund") : t("Dividend")}
        rows={[
          [t("Expense ratio"), pct(s.expense_ratio)],
          [t("Dividend yield"), pct(s.div_yield)],
          [t("Payout ratio"), pct(s.payout_ratio)],
          [t("Beta"), ratio(s.beta)],
        ]}
      />
    </section>
  );
}

function PriceSection({ d, token, strong, may }: { d: StockDetail; token: string | null; strong: number | null; may: number | null }) {
  const t = useT();
  const [range, setRange] = useState<ChartRange>("1Y");
  const { points, loading } = useChart(d.ticker, range, token);
  const change = points.length > 1 ? (points[points.length - 1][1] / points[0][1] - 1) * 100 : NaN;
  const levels = [
    ...(strong != null ? [{ value: strong, name: t("Strong buy until"), color: "#047857" }] : []),
    ...(may != null ? [{ value: may, name: t("May buy until"), color: "#b45309" }] : []),
  ];
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={cardTitle}>
          {t("Price")}{" "}
          <span className={`ml-1 text-xs font-semibold tabular-nums ${change >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{signedPct(change)}</span>
        </h2>
        <Segmented options={CHART_RANGES.map((r) => ({ value: r, label: r }))} value={range} onChange={setRange} label={t("Trend")} />
      </div>
      <div className="mt-4">
        <PriceChart points={points} levels={levels} loading={loading} format={(v) => priceText(v, d.currency)} />
      </div>
      {d.stats.low_52w != null && d.stats.high_52w != null ? (
        <p className="mt-2 text-[11px] tabular-nums text-[#8f8676]">
          {t("52-week range")}: {priceText(d.stats.low_52w, d.currency)} – {priceText(d.stats.high_52w, d.currency)}
          {d.stats.ma_200 != null ? ` · ${t("200-day average")} ${priceText(d.stats.ma_200, d.currency)}` : ""}
        </p>
      ) : null}
    </section>
  );
}

function FinancialsSection({ d }: { d: StockDetail }) {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = useState<"quarterly" | "annual">("quarterly");
  const f: Financials = d[view];
  const cur = d.financial_currency;
  const money = (v: number) => compactMoney(v, cur);
  const axisMoney = (v: number) => compactMoney(v, cur).replace(/\.00(?=[A-Z]|$)/, "");
  const periodLabel = (p: string) =>
    view === "annual"
      ? String(utcDate(p).getUTCFullYear())
      : utcDate(p).toLocaleDateString(locale, { month: "short", year: "2-digit", timeZone: "UTC" });
  const charts = [
    { title: t("Revenue"), series: [{ name: t("Revenue"), color: SERIES_BLUE, points: f.revenue }], format: money, axis: axisMoney },
    { title: t("Net income"), series: [{ name: t("Net income"), color: SERIES_BLUE, points: f.net_income }], format: money, axis: axisMoney },
    { title: t("Free cash flow"), series: [{ name: t("Free cash flow"), color: SERIES_BLUE, points: f.fcf }], format: money, axis: axisMoney },
    { title: "EPS", series: [{ name: "EPS", color: SERIES_BLUE, points: f.eps }], format: (v: number) => priceText(v, cur), axis: (v: number) => priceText(v, cur).replace(/\.00(?=\D*$)/, "") },
    {
      title: t("Cash & debt"),
      series: [
        { name: t("Cash"), color: SERIES_BLUE, points: f.cash },
        { name: t("Debt"), color: SERIES_ORANGE, points: f.debt },
      ],
      format: money,
      axis: axisMoney,
    },
    { title: t("Shares outstanding"), series: [{ name: t("Shares outstanding"), color: SERIES_BLUE, points: f.shares }], format: compactCount, axis: compactCount },
  ].filter((c) => c.series.some((s) => s.points.length));
  if (!d.quarterly.revenue.length && !d.annual.revenue.length) return null;
  return (
    <section className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={cardTitle}>{t("Financials")}</h2>
        <Segmented
          options={[
            { value: "quarterly", label: t("Quarterly") },
            { value: "annual", label: t("Annually") },
          ]}
          value={view}
          onChange={setView}
          label={t("Financials")}
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        {charts.map((c) => (
          <div key={c.title}>
            <h3 className="mb-2 text-xs font-semibold text-[#3b352d]">{c.title}</h3>
            <BarChart series={c.series} format={c.format} axisFormat={c.axis} periodLabel={periodLabel} />
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-[#8f8676]">{t("As reported, from Yahoo Finance: about the last 5 quarters or 4 fiscal years. The newest quarter can take a few days to appear after earnings.")}</p>
    </section>
  );
}

function Overview({ d }: { d: StockDetail }) {
  const t = useT();
  const p = d.profile;
  const [open, setOpen] = useState(false);
  const rows: [string, string | null][] = [
    ["CEO", p.ceo || null],
    [t("Sector"), p.sector || null],
    [t("Industry"), p.industry || null],
    [t("Country"), p.country || null],
    [t("Employees"), p.employees != null ? p.employees.toLocaleString("en-US") : null],
  ];
  const present = rows.filter((r) => r[1]);
  if (!p.summary && !present.length) return null;
  const long = p.summary.length > 420;
  return (
    <section className={card}>
      <h2 className={cardTitle}>{d.is_fund ? t("About the fund") : t("About the company")}</h2>
      {p.summary ? (
        <>
          <p className="mt-2 text-xs leading-relaxed text-[#3b352d]">{long && !open ? `${p.summary.slice(0, 420).trimEnd()}…` : p.summary}</p>
          {long ? (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-1 text-[11px] font-medium text-[#2a78d6] hover:underline">
              {open ? t("Show less") : t("Show more")}
            </button>
          ) : null}
        </>
      ) : null}
      <dl className="mt-3">
        {present.map(([name, value]) => (
          <div key={name} className="flex items-baseline justify-between gap-3 border-t border-black/5 py-1.5">
            <dt className="text-xs text-[#6f675b]">{name}</dt>
            <dd className="text-right text-xs font-medium text-[#1f1c17]">{value}</dd>
          </div>
        ))}
        {p.website ? (
          <div className="flex items-baseline justify-between gap-3 border-t border-black/5 py-1.5">
            <dt className="text-xs text-[#6f675b]">{t("Website")}</dt>
            <dd className="truncate text-xs font-medium">
              <a href={p.website} target="_blank" rel="noreferrer" className="text-[#2a78d6] hover:underline">
                {p.website.replace(/^https?:\/\/(www\.)?/, "")} ↗
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

const PERIOD_NAMES: Record<Estimate["period"], string> = {
  "0q": "Current quarter",
  "+1q": "Next quarter",
  "0y": "Current year",
  "+1y": "Next year",
};

function EstimateCard({ name, value, low, high, analysts }: { name: string; value: string; low: string; high: string; analysts: number | null }) {
  const t = useT();
  return (
    <div className="min-w-0 rounded-xl border border-black/5 bg-[#faf8f2] px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8f8676]">{name}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-[#1f1c17]">{value}</p>
      <p className="text-[11px] leading-snug tabular-nums text-[#6f675b]">
        {low} – {high}
      </p>
      {analysts != null ? <p className="text-[11px] text-[#8f8676]">{t("{n} analysts", { n: analysts })}</p> : null}
    </div>
  );
}

function Estimates({ d }: { d: StockDetail }) {
  const t = useT();
  const s = d.stats;
  const picks = d.estimates.filter((e) => e.period !== "+1q");
  if (!picks.length && s.target_mean == null && s.recommendation == null) return null;
  const upside = s.target_mean != null && d.price ? (s.target_mean / d.price - 1) * 100 : NaN;
  const cur = d.financial_currency;
  return (
    <section className={card}>
      <h2 className={cardTitle}>{t("Analyst estimates")}</h2>
      <dl className="mt-2">
        {s.recommendation != null ? (
          <div className="flex items-baseline justify-between gap-3 border-t border-black/5 py-1.5">
            <dt className="text-xs text-[#6f675b]">{t("Analyst consensus")}</dt>
            <dd className="text-xs font-semibold tabular-nums text-[#1f1c17]">{t(consensusLabel(s.recommendation), { v: s.recommendation.toFixed(1) })}</dd>
          </div>
        ) : null}
        {s.target_mean != null ? (
          <div className="flex items-baseline justify-between gap-3 border-t border-black/5 py-1.5">
            <dt className="text-xs text-[#6f675b]">{t("Analyst target")}</dt>
            <dd className="text-right text-xs font-semibold tabular-nums text-[#1f1c17]">
              {priceText(s.target_mean, d.currency)} ({signedPct(upside, 1)})
              {s.target_low != null && s.target_high != null ? (
                <span className="block text-[11px] font-normal text-[#8f8676]">
                  {priceText(s.target_low, d.currency)} – {priceText(s.target_high, d.currency)}
                </span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {picks.some((e) => e.eps_avg != null) ? (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]">EPS</p>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {picks.filter((e) => e.eps_avg != null).map((e) => (
              <EstimateCard key={e.period} name={t(PERIOD_NAMES[e.period])} value={priceText(e.eps_avg, cur)} low={priceText(e.eps_low, cur)} high={priceText(e.eps_high, cur)} analysts={e.eps_analysts} />
            ))}
          </div>
        </>
      ) : null}
      {picks.some((e) => e.revenue_avg != null) ? (
        <>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]">{t("Revenue")}</p>
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {picks.filter((e) => e.revenue_avg != null).map((e) => (
              <EstimateCard key={e.period} name={t(PERIOD_NAMES[e.period])} value={compactMoney(e.revenue_avg, cur)} low={compactMoney(e.revenue_low, cur)} high={compactMoney(e.revenue_high, cur)} analysts={e.revenue_analysts} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Insiders({ d, token }: { d: StockDetail; token: string | null }) {
  const t = useT();
  const dayText = useDayText();
  const [open, setOpen] = useState(false);
  const { points, loading } = useChart(d.insiders.length ? d.ticker : null, "1Y", token);
  const marks = useMemo<PriceMark[]>(
    () => d.insiders.filter((i) => i.value).map((i) => ({ date: i.date, kind: i.kind, value: i.value ?? 0, count: 1 })),
    [d.insiders],
  );
  if (!d.insiders.length) return null;
  const sold = d.insiders.filter((i) => i.kind === "sell").reduce((a, i) => a + (i.value ?? 0), 0);
  const bought = d.insiders.filter((i) => i.kind === "buy").reduce((a, i) => a + (i.value ?? 0), 0);
  return (
    <section className={card}>
      <h2 className={cardTitle}>{t("Insider activity")}</h2>
      <p className="mt-0.5 text-xs text-[#6f675b]">{t("Purchases and sales over the last 12 months, against the daily price")}</p>
      <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] text-[#6f675b]">
            <span className="h-2 w-2 rounded-full bg-[#059669]" aria-hidden />
            {t("Reported buys")}
          </p>
          <p className="text-xl font-semibold tabular-nums text-[#1f1c17]">{compactMoney(bought)}</p>
        </div>
        <div>
          <p className="flex items-center gap-1.5 text-[11px] text-[#6f675b]">
            <span className="h-2 w-2 rounded-full bg-[#e11d48]" aria-hidden />
            {t("Reported sells")}
          </p>
          <p className="text-xl font-semibold tabular-nums text-[#1f1c17]">{compactMoney(sold)}</p>
        </div>
        <p className="ml-auto text-[11px] text-[#8f8676]">{t("Larger dots = larger trades")}</p>
      </div>
      <div className="mt-3">
        <PriceChart points={points} marks={marks} loading={loading} format={(v) => priceText(v, d.currency)} markFormat={(v) => compactMoney(v)} height="h-48" />
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mt-3 flex w-full items-center justify-between border-t border-black/5 pt-3 text-xs font-semibold text-[#1f1c17]"
      >
        {t("View trades ({n})", { n: d.insiders.length })}
        <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-xs">
            <thead className="text-[11px] uppercase tracking-wide text-[#8f8676]">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{t("Date")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("Insider")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("Type")}</th>
                <th className="py-1.5 pr-3 text-right font-medium">{t("Shares")}</th>
                <th className="py-1.5 text-right font-medium">{t("Value")}</th>
              </tr>
            </thead>
            <tbody>
              {d.insiders.map((i, n) => (
                <tr key={`${i.date}-${i.name}-${n}`} className="border-t border-black/5">
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums text-[#6f675b]">{dayText(i.date)}</td>
                  <td className="py-1.5 pr-3 text-[#1f1c17]">
                    {i.name}
                    {i.relation ? <span className="block text-[11px] text-[#8f8676]">{i.relation}</span> : null}
                  </td>
                  <td className="py-1.5 pr-3 font-medium text-[#3b352d]">{i.kind === "buy" ? t("Buy") : t("Sell")}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-[#3b352d]">{compactCount(i.shares)}</td>
                  <td className="py-1.5 text-right tabular-nums text-[#1f1c17]">{compactMoney(i.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function useCompanyFacts(d: StockDetail | null): string[] {
  const t = useT();
  if (!d) return [];
  const s = d.stats;
  return [
    s.revenue_growth != null ? t("Revenue {v} (YoY)", { v: signedPct(s.revenue_growth) }) : null,
    s.operating_margin != null ? t("Operating margin {v}", { v: `${s.operating_margin.toFixed(1)}%` }) : null,
    s.net_cash != null
      ? t(s.net_cash >= 0 ? "Net cash {v}" : "Net debt {v}", { v: compactMoney(Math.abs(s.net_cash), d.financial_currency) })
      : null,
  ].filter((f): f is string => f != null);
}

export default function StockPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = use(params);
  const ticker = decodeURIComponent(raw).trim().toUpperCase();
  const { token } = useAuth();
  const t = useT();
  const router = useRouter();
  const { data: detail, error, loading } = useStockDetail(ticker, token);
  const { data: fit, loading: fitLoading } = useStockFit(ticker, token);
  const companyFacts = useCompanyFacts(detail);

  function back() {
    if (window.history.length > 1) router.back();
    else router.push("/investing/picking");
  }

  return (
    <div className={investingPageStack}>
      <div>
        <button type="button" onClick={back} className={investingToolbarBtn}>
          ← {t("Back")}
        </button>
      </div>

      {loading ? (
        <p className={`${card} text-center text-sm text-[#8f8676]`} role="status">
          {t("Loading {ticker}…", { ticker })}
        </p>
      ) : !detail ? (
        <p className={`${card} text-center text-sm text-[#6f675b]`} role="alert">
          {error || t("No market data found for {ticker}", { ticker })}
        </p>
      ) : (
        <>
          <Header d={detail} />
          <AiReview ticker={ticker} token={token} fit={fit} fitLoading={fitLoading} companyFacts={companyFacts} />
          <KeyStats d={detail} />
          <PriceSection d={detail} token={token} strong={fit?.strong_buy ?? null} may={fit?.may_buy ?? null} />
          <FinancialsSection d={detail} />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 [&>*]:min-w-0">
            <div className="space-y-5">
              <Overview d={detail} />
              <Estimates d={detail} />
            </div>
            <section className={card}>
              <h2 className={cardTitle}>{t("News")}</h2>
              <News ticker={ticker} token={token} />
            </section>
          </div>
          <Insiders d={detail} token={token} />
        </>
      )}
    </div>
  );
}
