"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export const PERIODS = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"] as const;
export type Period = (typeof PERIODS)[number];

export const CHART_RANGES = ["1M", "6M", "1Y", "5Y"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/** Finviz snapshot for one ticker (see back/app/investing/watchlist.py). */
export type WatchlistSnapshot = {
  name: string;
  exchange: string;
  is_fund: boolean;
  sector: string;
  price: number | null;
  change_pct: number | null;
  market_cap: string;
  pe: number | null;
  forward_pe: number | null;
  ev_ebitda: number | null;
  recom: number | null;
  target_price: number | null;
  sales_growth: number | null;
  expense: number | null;
  div_yield: number | null;
  high_52w: number | null;
  low_52w: number | null;
  perf: Partial<Record<Period, number>>;
};

export type NewsItem = { title: string; link: string; published: string | null; summary: string };

/**
 * Loads `path` whenever it changes (null = nothing to load). The last result is kept while the
 * next one loads, so lists don't flash empty when a ticker is added.
 */
function useApi<T>(path: string | null, token: string | null, empty: T): { data: T; loading: boolean } {
  const [res, setRes] = useState<{ path: string; data: T } | null>(null);
  useEffect(() => {
    if (!path || !token) return;
    let alive = true;
    apiFetch<T>(path, { token })
      .then((data) => {
        if (alive) setRes({ path, data });
      })
      .catch(() => {
        if (alive) setRes({ path, data: empty });
      });
    return () => {
      alive = false;
    };
    // `empty` is a constant fallback; it must not restart the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, token]);
  return { data: res?.data ?? empty, loading: !!path && res?.path !== path };
}

const NO_SNAPSHOTS = { snapshots: {} as Record<string, WatchlistSnapshot> };
const NO_POINTS = { points: [] as [number, number][] };
const NO_NEWS = { items: [] as NewsItem[] };

export function useSnapshots(tickers: string[], token: string | null) {
  const key = [...new Set(tickers)].sort().join(",");
  const { data, loading } = useApi(key ? `/investing/watchlist/snapshots?tickers=${encodeURIComponent(key)}` : null, token, NO_SNAPSHOTS);
  return { snapshots: data.snapshots, loading };
}

export function useChart(ticker: string | null, range: ChartRange, token: string | null) {
  const { data, loading } = useApi(ticker ? `/investing/watchlist/chart?ticker=${encodeURIComponent(ticker)}&range=${range}` : null, token, NO_POINTS);
  return { points: data.points, loading };
}

export function useNews(ticker: string | null, token: string | null) {
  const { data, loading } = useApi(ticker ? `/investing/watchlist/news?ticker=${encodeURIComponent(ticker)}` : null, token, NO_NEWS);
  return { items: data.items, loading };
}

/** Finviz "5024.92B" → "$5.02T". */
export function formatCap(text: string): string {
  const m = /^([\d.]+)\s*([KMBT])?$/i.exec(text.trim());
  if (!m) return text || "—";
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] ?? "").toUpperCase() as "K"] ?? 1;
  const v = Number(m[1]) * mult;
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

/** Analysts' mean recommendation (1 = strong buy … 5 = sell) as an interface text key taking {v}. */
export function consensusLabel(recom: number): string {
  if (recom <= 1.5) return "Strong buy · {v}";
  if (recom <= 2.5) return "Buy · {v}";
  if (recom <= 3.5) return "Hold · {v}";
  if (recom <= 4.5) return "Sell · {v}";
  return "Strong sell · {v}";
}
