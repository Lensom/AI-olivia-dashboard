"use client";

import { useEffect, useState } from "react";
import type { AttentionItem } from "@/features/investing/attention";
import { formatUsd } from "@/features/investing/format";
import type { InvestingHolding } from "@/features/investing/types";
import { apiFetch } from "@/lib/api";
import type { T } from "@/lib/i18n";
import type { InvestingPickingRow } from "@/state/investing-store";

/** Mirrors TickerEvents in back/app/investing/events.py. */
export type DividendDate = { date: string; amount: number | null; estimated: boolean };
export type TickerEvents = {
  ticker: string;
  earnings_date: string;
  earnings_time: "" | "BMO" | "AMC";
  earnings_estimated: boolean;
  dividend_frequency: number | null;
  dividend_amount: number | null;
  last_ex_date: string;
  ex_dates: DividendDate[];
  history: DividendDate[];
};

export type CalendarEvent = {
  id: string;
  date: string; // ISO
  ticker: string;
  name: string;
  type: "earnings" | "dividend";
  /** In your portfolio (otherwise only on the watchlist). */
  held: boolean;
  estimated: boolean;
  /** Earnings: before the open / after the close. */
  time?: "" | "BMO" | "AMC";
  /** Dividend per share, and what your shares would get. */
  perShare?: number | null;
  income?: number | null;
};

/** Events for the given tickers; refetched when the set changes. */
export function useTickerEvents(token: string | null, tickers: string[]): { events: Record<string, TickerEvents>; isLoading: boolean } {
  const key = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort().join(",");
  const [state, setState] = useState<{ key: string; events: Record<string, TickerEvents> } | null>(null);

  useEffect(() => {
    if (!token || !key) return;
    let alive = true;
    apiFetch<{ events: Record<string, TickerEvents> }>(`/investing/events?tickers=${encodeURIComponent(key)}`, { token })
      .then((r) => alive && setState({ key, events: r.events }))
      .catch(() => alive && setState({ key, events: {} }));
    return () => {
      alive = false;
    };
  }, [token, key]);

  return { events: state?.events ?? {}, isLoading: !!key && state?.key !== key };
}

/** Tickers worth tracking: holdings first, then the watchlist. */
export function trackedTickers(holdings: InvestingHolding[], picking: InvestingPickingRow[]): string[] {
  return [...new Set([...holdings.map((h) => h.ticker), ...picking.map((p) => p.ticker)].map((t) => t.trim().toUpperCase()).filter(Boolean))];
}

/** Every earnings report and ex-dividend date from `from` on, soonest first. */
export function calendarEvents(
  events: Record<string, TickerEvents>,
  holdings: InvestingHolding[],
  picking: InvestingPickingRow[],
  from: string,
): CalendarEvent[] {
  const shares = new Map(holdings.map((h) => [h.ticker.trim().toUpperCase(), h.shares]));
  const names = new Map<string, string>();
  for (const p of picking) if (p.name) names.set(p.ticker.trim().toUpperCase(), p.name);
  for (const h of holdings) if (h.name) names.set(h.ticker.trim().toUpperCase(), h.name);

  const out: CalendarEvent[] = [];
  for (const e of Object.values(events)) {
    const held = (shares.get(e.ticker) ?? 0) > 0;
    const name = names.get(e.ticker) ?? "";
    if (e.earnings_date && e.earnings_date >= from) {
      out.push({ id: `${e.ticker}-e-${e.earnings_date}`, date: e.earnings_date, ticker: e.ticker, name, type: "earnings", held, estimated: e.earnings_estimated, time: e.earnings_time });
    }
    for (const d of e.ex_dates) {
      if (d.date < from) continue;
      out.push({
        id: `${e.ticker}-d-${d.date}`,
        date: d.date,
        ticker: e.ticker,
        name,
        type: "dividend",
        held,
        estimated: d.estimated,
        perShare: d.amount,
        income: held && d.amount != null ? d.amount * (shares.get(e.ticker) ?? 0) : null,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || Number(b.held) - Number(a.held) || a.ticker.localeCompare(b.ticker));
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** "Needs attention" items: reports and confirmed ex-dividend dates of your holdings in the next week. */
export function eventAttention(list: CalendarEvent[], today: string, t: T, locale: string): AttentionItem[] {
  const when = (date: string) => {
    const n = daysBetween(today, date);
    return n === 0 ? t("today") : n === 1 ? t("tomorrow") : t("in {n} days", { n });
  };
  const day = (date: string) => new Date(date).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return list
    .filter((e) => e.held && !e.estimated && daysBetween(today, e.date) <= 7)
    .map((e) =>
      e.type === "earnings"
        ? {
            id: e.id,
            kind: "event" as const,
            title: t("{ticker} reports earnings {when}", { ticker: e.ticker, when: when(e.date) }),
            detail: [day(e.date), e.time === "AMC" ? t("after the close") : e.time === "BMO" ? t("before the open") : ""].filter(Boolean).join(" · "),
            href: "/investing/calendar",
          }
        : {
            id: e.id,
            kind: "event" as const,
            title: t("{ticker} goes ex-dividend {when}", { ticker: e.ticker, when: when(e.date) }),
            detail: [day(e.date), e.income != null ? t("≈ {v} for your shares", { v: formatUsd(e.income) }) : ""].filter(Boolean).join(" · "),
            href: "/investing/calendar",
          },
    );
}
