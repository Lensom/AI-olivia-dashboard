"use client";

import { useEffect, useState } from "react";
import { apiFetch, type ApiError } from "@/lib/api";

/** See back/app/investing/stock.py. Percent fields are in percent (12.3 = 12.3%). */
export type Point = { period: string; value: number };

export type Financials = {
  revenue: Point[];
  net_income: Point[];
  fcf: Point[];
  eps: Point[];
  cash: Point[];
  debt: Point[];
  shares: Point[];
  sbc: Point[];
};

export type Stats = {
  market_cap: number | null;
  pe: number | null;
  forward_pe: number | null;
  peg: number | null;
  price_to_sales: number | null;
  price_to_book: number | null;
  ev_ebitda: number | null;
  fcf_ttm: number | null;
  sbc_ttm: number | null;
  fcf_yield: number | null;
  fcf_yield_after_sbc: number | null;
  gross_margin: number | null;
  operating_margin: number | null;
  profit_margin: number | null;
  revenue_growth: number | null;
  earnings_growth: number | null;
  return_on_equity: number | null;
  cash: number | null;
  debt: number | null;
  net_cash: number | null;
  div_yield: number | null;
  payout_ratio: number | null;
  expense_ratio: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  ma_50: number | null;
  ma_200: number | null;
  target_mean: number | null;
  target_low: number | null;
  target_high: number | null;
  recommendation: number | null;
  analysts: number | null;
};

export type Estimate = {
  period: "0q" | "+1q" | "0y" | "+1y";
  eps_avg: number | null;
  eps_low: number | null;
  eps_high: number | null;
  eps_analysts: number | null;
  revenue_avg: number | null;
  revenue_low: number | null;
  revenue_high: number | null;
  revenue_analysts: number | null;
  eps_growth: number | null;
};

export type InsiderTrade = {
  date: string;
  name: string;
  relation: string;
  kind: "buy" | "sell";
  shares: number | null;
  value: number | null;
};

export type StockDetail = {
  ticker: string;
  name: string;
  exchange: string;
  is_fund: boolean;
  currency: string;
  financial_currency: string;
  price: number | null;
  change: number | null;
  change_pct: number | null;
  earnings_date: string | null;
  earnings_date_estimated: boolean;
  ex_dividend_date: string | null;
  profile: {
    summary: string;
    sector: string;
    industry: string;
    country: string;
    website: string;
    employees: number | null;
    ceo: string;
  };
  stats: Stats;
  estimates: Estimate[];
  quarterly: Financials;
  annual: Financials;
  insiders: InsiderTrade[];
};

/** The arithmetic checks (back/app/investing/analysis.py, StockFit). */
export type StockFit = {
  ticker: string;
  price: number | null;
  zone: "strong" | "may" | "above" | "unset";
  strong_buy: number | null;
  may_buy: number | null;
  on_watchlist: boolean;
  owned: boolean;
  shares: number;
  value: number;
  weight: number | null;
  target_weight: number | null;
  room: "room" | "full" | "unknown";
  room_basis: "target" | "bucket" | "none";
  full_reason: "target" | "bucket_weight" | "bucket_positions" | null;
  room_usd: number | null;
  cash: number | null;
  max_buy_usd: number | null;
  max_buy_shares: number | null;
  bucket: string | null;
  bucket_weight: number | null;
  bucket_target: number | null;
  bucket_positions: number | null;
  bucket_max: number | null;
  sector: string | null;
  sector_weight: number | null;
  stale_data?: boolean;
};

export type StockReview = {
  verdict: "buy" | "buy_partial" | "wait_price" | "no_room" | "avoid";
  confidence: "low" | "medium" | "high";
  headline: string;
  company_health: "strong" | "solid" | "mixed" | "weak";
  company_state: string;
  valuation: string;
  price_check: string;
  portfolio_check: string;
  strengths: string[];
  risks: string[];
  action: string;
  change_mind: string;
};

export type StockReviewResponse = {
  ticker: string;
  review: StockReview;
  model: string;
  lang: string;
  fit: StockFit;
  created_at: string;
};

/** Where a stock's page lives; every list that links to it goes through this. */
export function stockHref(ticker: string): string {
  return `/investing/stock/${encodeURIComponent(ticker.trim().toUpperCase())}`;
}

/** Loads `path`, reporting failures; results are keyed by path, so a new ticker never shows the old one's data. */
function useLoad<T>(path: string, token: string | null) {
  const [res, setRes] = useState<{ path: string; data: T | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<T>(path, { token })
      .then((data) => {
        if (alive) setRes({ path, data, error: null });
      })
      .catch((err: ApiError) => {
        if (alive) setRes({ path, data: null, error: err.message || "error" });
      });
    return () => {
      alive = false;
    };
  }, [path, token]);
  const current = res?.path === path ? res : null;
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !current };
}

export function useStockDetail(ticker: string, token: string | null) {
  return useLoad<StockDetail>(`/investing/stock/${encodeURIComponent(ticker)}`, token);
}

export function useStockFit(ticker: string, token: string | null) {
  return useLoad<StockFit>(`/investing/analysis/${encodeURIComponent(ticker)}/fit`, token);
}

/** $5.07T, $114.50B, $31.9M; other currencies carry their code: 1.20T TWD. */
export function compactMoney(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const a = Math.abs(value);
  const text =
    a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e4 ? `${(a / 1e3).toFixed(1)}K` : a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value < 0 ? "-" : "";
  return currency === "USD" ? `${sign}$${text}` : `${sign}${text} ${currency}`;
}

export function compactCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const a = Math.abs(value);
  return a >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(value / 1e3).toFixed(1)}K` : `${Math.round(value)}`;
}

/** A price with its currency; USD as $348.79. */
export function priceText(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const text = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value < 0 ? "-" : "";
  return currency === "USD" ? `${sign}$${text}` : `${sign}${text} ${currency}`;
}
