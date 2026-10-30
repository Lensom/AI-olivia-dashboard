"use client";

import { useMemo, useState } from "react";
import { calendarEvents, daysBetween, trackedTickers, useTickerEvents, type CalendarEvent } from "@/features/investing/events";
import { formatUsd, parseUsd } from "@/features/investing/format";
import { investingPageStack } from "@/features/investing/ui/investing-classes";
import { TickerLogo } from "@/features/investing/watchlist/ticker-logo";
import { VBars } from "@/features/shared/bar-charts";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useInvesting } from "@/state/investing-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

type Scope = "all" | "held" | "watch";
type Kind = "all" | "earnings" | "dividend";
const RANGES = [
  { days: 30, label: "Next 30 days" },
  { days: 90, label: "Next 3 months" },
  { days: 365, label: "Next 12 months" },
];

const chip = (active: boolean) =>
  `rounded-full border px-3 py-1 text-xs font-medium transition ${
    active ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"
  }`;

function EventRow({ e }: { e: CalendarEvent }) {
  const t = useT();
  const isEarnings = e.type === "earnings";
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <TickerLogo ticker={e.ticker} size={32} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-semibold text-[#1f1c17]">{e.ticker}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isEarnings ? "bg-violet-100 text-violet-800" : "bg-emerald-100 text-emerald-800"}`}
          >
            {isEarnings ? t("Earnings") : t("Ex-dividend")}
          </span>
          {e.held ? null : <span className="rounded-full bg-[#f3efe5] px-2 py-0.5 text-[11px] text-[#6f675b]">{t("Watchlist")}</span>}
          {e.estimated ? (
            <span className="text-[11px] text-[#8f8676]" title={t("Projected from the usual schedule; not announced yet")}>
              ≈ {t("estimated")}
            </span>
          ) : null}
        </p>
        <p className="truncate text-[11px] text-[#8f8676]">
          {[
            e.name,
            isEarnings && e.time === "AMC" ? t("after the close") : isEarnings && e.time === "BMO" ? t("before the open") : "",
            !isEarnings && e.perShare != null ? t("{v} per share", { v: formatUsd(e.perShare) }) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      {e.income != null ? (
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums text-emerald-700">+{formatUsd(e.income)}</span>
          <span className="block text-[10px] text-[#8f8676]">{t("for your shares")}</span>
        </span>
      ) : null}
    </li>
  );
}

export default function InvestingCalendarPage() {
  const t = useT();
  const locale = useLocale();
  const { token } = useAuth();
  const { holdings, pickingRows, isHoldingsLoading } = useInvesting();
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [scope, setScope] = useState<Scope>("all");
  const [kind, setKind] = useState<Kind>("all");
  const [rangeDays, setRangeDays] = useState(90);

  const tickers = useMemo(() => trackedTickers(holdings, pickingRows), [holdings, pickingRows]);
  const { events, isLoading } = useTickerEvents(token, tickers);
  const all = useMemo(() => calendarEvents(events, holdings, pickingRows, today), [events, holdings, pickingRows, today]);

  const summary = useMemo(() => {
    const held = all.filter((e) => e.held);
    const income = (days: number) => held.filter((e) => e.type === "dividend" && daysBetween(today, e.date) <= days).reduce((s, e) => s + (e.income ?? 0), 0);
    const value = holdings.reduce((s, h) => s + parseUsd(h.marketValue), 0);
    const year = income(365);
    // Dividend income by month of the ex-date, for the next 12 months.
    const start = new Date(today);
    const months: [string, number][] = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const sum = held.filter((e) => e.type === "dividend" && e.date.startsWith(key)).reduce((s, e) => s + (e.income ?? 0), 0);
      return [d.toLocaleDateString(locale, { month: "short" }), Math.round(sum)];
    });
    return {
      nextEarnings: held.find((e) => e.type === "earnings") ?? null,
      month: income(30),
      year,
      yieldPct: value > 0 ? (year / value) * 100 : null,
      months: months.some((m) => m[1] > 0) ? months : [],
      payers: new Set(held.filter((e) => e.type === "dividend").map((e) => e.ticker)).size,
    };
  }, [all, holdings, today, locale]);

  const shown = useMemo(
    () =>
      all.filter(
        (e) =>
          daysBetween(today, e.date) <= rangeDays &&
          (scope === "all" || (scope === "held") === e.held) &&
          (kind === "all" || e.type === kind),
      ),
    [all, today, rangeDays, scope, kind],
  );

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of shown) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [shown]);

  const when = (date: string) => {
    const n = daysBetween(today, date);
    return n === 0 ? t("today") : n === 1 ? t("tomorrow") : t("in {n} days", { n });
  };

  if (!tickers.length && !isHoldingsLoading) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center">
        <p className="text-sm font-medium text-[#1f1c17]">{t("Nothing to track yet")}</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-[#6f675b]">{t("Add holdings on Portfolio or tickers to your Watchlist, and their earnings and dividends show up here.")}</p>
      </div>
    );
  }

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        {t("Earnings reports and ex-dividend dates for your holdings and watchlist. Dates from Finviz; future dividends are projected from each ticker's payment history.")}
      </p>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Next earnings in your portfolio")}</p>
          {summary.nextEarnings ? (
            <>
              <p className="mt-1 flex items-center gap-2 text-2xl font-semibold text-[#1f1c17]">
                <TickerLogo ticker={summary.nextEarnings.ticker} size={28} />
                {summary.nextEarnings.ticker}
              </p>
              <p className="mt-0.5 text-xs text-[#6f675b]">
                {new Date(summary.nextEarnings.date).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" })} · {when(summary.nextEarnings.date)}
                {summary.nextEarnings.estimated ? ` · ≈ ${t("estimated")}` : ""}
              </p>
            </>
          ) : (
            <p className="mt-1 text-2xl font-semibold text-[#1f1c17]">{isLoading ? "…" : "—"}</p>
          )}
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Dividends, next 30 days")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{isLoading ? "…" : formatUsd(summary.month)}</p>
          <p className="mt-0.5 text-xs text-[#6f675b]">{t("by ex-date, before tax")}</p>
        </div>
        <div className={card}>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Dividends, next 12 months")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-700">{isLoading ? "…" : formatUsd(summary.year)}</p>
          <p className="mt-0.5 text-xs text-[#6f675b]">
            {summary.yieldPct != null
              ? t("{v}% of portfolio value · {n} paying holdings", { v: summary.yieldPct.toFixed(2), n: summary.payers })
              : t("at the latest dividend per share")}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", "All"],
            ["held", "Holdings"],
            ["watch", "Watchlist"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setScope(v)} className={chip(scope === v)} aria-pressed={scope === v}>
            {t(label)}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-black/10" aria-hidden />
        {(
          [
            ["all", "All events"],
            ["earnings", "Earnings"],
            ["dividend", "Dividends"],
          ] as const
        ).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setKind(v)} className={chip(kind === v)} aria-pressed={kind === v}>
            {t(label)}
          </button>
        ))}
        <select
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
          className="ml-auto rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]"
          aria-label={t("Period")}
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {t(r.label)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3 [&>*]:min-w-0">
        <section className="xl:col-span-2">
          {isLoading ? (
            <p className="text-sm text-[#8f8676]">{t("Loading events for {n} tickers…", { n: tickers.length })}</p>
          ) : !byDay.length ? (
            <p className="text-sm text-[#8f8676]">{t("No events in this period.")}</p>
          ) : (
            <ol className="space-y-3">
              {byDay.map(([date, list]) => (
                <li key={date} className="overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
                  <p className="flex items-baseline justify-between gap-2 border-b border-black/5 bg-[#faf8f2] px-4 py-2 text-xs">
                    <span className="font-semibold capitalize text-[#1f1c17]">
                      {new Date(date).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                    <span className="text-[#8f8676]">{when(date)}</span>
                  </p>
                  <ul className="divide-y divide-black/5">
                    {list.map((e) => (
                      <EventRow key={e.id} e={e} />
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className={`${card} self-start`}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{t("Dividend income by month")}</h2>
          <p className="mb-5 text-xs text-[#6f675b]">{t("Next 12 months by ex-date; the payment usually lands 1–4 weeks later.")}</p>
          <VBars rows={summary.months} unit="${n}" empty="No dividends expected from your holdings." />
          <p className="mt-3 text-[11px] leading-snug text-[#8f8676]">{t("Amounts use the latest dividend per share and your current shares, before withholding tax.")}</p>
        </aside>
      </div>
    </div>
  );
}
