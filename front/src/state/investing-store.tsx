"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import type { InvestingHolding } from "@/features/investing/types";
import { useAuth } from "./auth-store";
import { apiFetch } from "@/lib/api";
import { formatUsd, parseUsd } from "@/features/investing/format";

export type InvestingCapitalEntry = {
  id: string;
  date: string;
  deposit: string;
  total_value: string;
  roi_percent: string;
  one_year_percent: string;
};

export type InvestingActivity = {
  id: string;
  type: "buy" | "sell";
  name: string;
  ticker: string;
  category: string;
  count: number;
  price: string;
  currency: string;
  amount: string;
  gains_losses: string;
  commission: string;
  date: string;
  amount_usd?: string;
  gains_losses_usd?: string;
  commission_usd?: string;
  fx_rate_to_usd?: string;
};

export type InvestingActivityYearSummary = {
  year: string;
  purchases_amount: string;
  purchases_commission: string;
  sales_amount: string;
  sales_pnl: string;
  sales_commission: string;
  net_cash_flow: string;
};

export type InvestingRefillRow = {
  id: string;
  date: string;
  amount: string;
  commission: string;
};

export type InvestingPickingRow = {
  id: string;
  /** etf_reit_fund | value_blue_chips */
  bucket: string;
  name: string;
  ticker: string;
  industry: string;
  pe: string;
  eps: string;
  beta: string;
  div_yield: string;
  /** From quote API on load (not persisted) */
  current_price: string;
  day_change_pct: string;
  strong_buy_until: string;
  may_buy_until: string;
  buy_right_now: string;
  price_goal_1y: string;
  price_goal_5y: string;
  notes: string;
};

type InvestingStore = {
  holdings: InvestingHolding[];
  holdingsMeta: { source: "server" | "default"; updatedAt: string | null };
  capitalEntries: InvestingCapitalEntry[];
  capitalEntriesMeta: { updatedAt: string | null };
  activities: InvestingActivity[];
  activitiesSummary: InvestingActivityYearSummary[];
  activitiesMeta: { updatedAt: string | null };
  pickingRows: InvestingPickingRow[];
  pickingMeta: { updatedAt: string | null };
  isPickingLoading: boolean;
  isPickingSaving: boolean;
  isPickingDirty: boolean;
  refills: InvestingRefillRow[];
  operatingExpensesUsd: string;
  refillsMeta: { updatedAt: string | null };
  isRefillsLoading: boolean;
  isRefillsSaving: boolean;
  isRefillsDirty: boolean;
  isActivitiesLoading: boolean;
  isActivitiesSaving: boolean;
  isActivitiesDirty: boolean;
  isCapitalEntriesLoading: boolean;
  isCapitalEntriesDirty: boolean;
  isCapitalEntriesSaving: boolean;
  metrics: { divYieldPercent: string; beta: string; allocationPercent: Record<string, string> };
  isMetricsLoading: boolean;
  isHoldingsLoading: boolean;
  isMarketPricesLoading: boolean;
  notes: string;
  notesMeta: { updatedAt: string | null };
  isNotesLoading: boolean;
  isNotesSaving: boolean;
  isNotesDirty: boolean;
  isHoldingsDirty: boolean;
  isHoldingsSaving: boolean;
  updateHolding: (id: string, patch: Partial<InvestingHolding>) => void;
  addHolding: () => void;
  deleteHolding: (id: string) => void;
  reset: () => void;
  updateCapitalEntry: (id: string, patch: Partial<InvestingCapitalEntry>) => void;
  addCapitalEntry: () => void;
  deleteCapitalEntry: (id: string) => void;
  updateActivity: (id: string, patch: Partial<InvestingActivity>) => void;
  addActivity: (type: "buy" | "sell") => void;
  deleteActivity: (id: string) => void;
  updatePickingRow: (id: string, patch: Partial<InvestingPickingRow>) => void;
  addPickingRow: () => void;
  deletePickingRow: (id: string) => void;
  refreshPicking: () => Promise<void>;
  savePicking: () => Promise<void>;
  updateRefill: (id: string, patch: Partial<InvestingRefillRow>) => void;
  addRefill: () => void;
  deleteRefill: (id: string) => void;
  setOperatingExpensesUsd: (value: string) => void;
  refreshRefills: () => Promise<void>;
  saveRefills: () => Promise<void>;
  refreshActivities: () => Promise<void>;
  saveActivities: () => Promise<void>;
  refreshCapitalEntries: () => Promise<void>;
  saveCapitalEntries: () => Promise<void>;
  refreshHoldings: () => Promise<void>;
  refreshMarketPrices: () => Promise<void>;
  saveHoldings: () => Promise<void>;
  importHoldings: (file: File) => Promise<InvestingHoldingsImportSummary>;
  setNotes: (next: string) => void;
  refreshNotes: () => Promise<void>;
  saveNotes: () => Promise<void>;
  refreshMetrics: () => Promise<void>;
  updateMetrics: (
    patch: Partial<{ divYieldPercent: string; beta: string; allocationPercent: Record<string, string> }>,
  ) => Promise<void>;
};

export type InvestingHoldingsImportSummary = {
  added: string[];
  updated: string[];
  /** Holdings already in the table but absent from the file (kept as-is). */
  notInFile: string[];
  skipped: string[];
};

type InvestingHoldingImportRow = {
  ticker: string;
  shares: number;
  avgBuyPrice: number;
  marketPrice: number;
  marketValue: number;
};

const InvestingContext = createContext<InvestingStore | null>(null);

function createEmptyHolding(): InvestingHolding {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
  return {
    id,
    ticker: "NEW",
    name: "New holding",
    industry: "—",
    targetWeight: "0.0%",
    currentWeight: "0.0%",
    shares: 0,
    avgBuyPrice: "$0.00",
    marketPrice: "$0.00",
    dayChangePercent: "—",
    marketValue: "$0.00",
    pnl: "$0.00",
    trend: "up",
  };
}

function computePnl(h: InvestingHolding): string {
  const cost = (h.shares ?? 0) * parseUsd(h.avgBuyPrice ?? "$0");
  const value = parseUsd(h.marketValue ?? "$0");
  const pnl = value - cost;
  const formatted = formatUsd(pnl);
  return pnl > 0 ? `+${formatted}` : formatted;
}

function normalizeHoldings(rows: InvestingHolding[]): InvestingHolding[] {
  const totalValue = rows.reduce((sum, row) => sum + parseUsd(row.marketValue ?? "$0"), 0);
  return rows.map((row) => {
    const value = parseUsd(row.marketValue ?? "$0");
    const currentWeight = totalValue > 0 ? `${((value / totalValue) * 100).toFixed(1)}%` : "0.0%";
    const base: InvestingHolding = { ...row, currentWeight };
    return { ...base, pnl: computePnl(base) };
  });
}

function applyMarketPrices(
  rows: InvestingHolding[],
  prices: Record<string, number>,
  dayChangeByTicker?: Record<string, number>,
): InvestingHolding[] {
  const updated = rows.map((row) => {
    const ticker = (row.ticker ?? "").trim().toUpperCase();
    let next: InvestingHolding = { ...row };
    const market = prices[ticker];
    if (typeof market === "number" && Number.isFinite(market)) {
      const shares = Number(row.shares ?? 0) || 0;
      next = {
        ...next,
        marketPrice: formatUsd(market),
        marketValue: formatUsd(market * shares),
      };
    }
    if (dayChangeByTicker !== undefined) {
      const d = dayChangeByTicker[ticker];
      next = {
        ...next,
        dayChangePercent:
          typeof d === "number" && Number.isFinite(d) ? `${d > 0 ? "+" : ""}${d.toFixed(2)}%` : "—",
      };
    }
    return next;
  });
  return normalizeHoldings(updated);
}

export function InvestingProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [holdings, setHoldings] = useState<InvestingHolding[]>([]);
  const [holdingsMeta, setHoldingsMeta] = useState<{
    source: "server" | "default";
    updatedAt: string | null;
  }>({ source: "default", updatedAt: null });
  const [isHoldingsLoading, setHoldingsLoading] = useState(false);
  const [isMarketPricesLoading, setMarketPricesLoading] = useState(false);
  const [isHoldingsDirty, setHoldingsDirty] = useState(false);
  const [isHoldingsSaving, setHoldingsSaving] = useState(false);
  const [notes, setNotesState] = useState("");
  const [notesMeta, setNotesMeta] = useState<{ updatedAt: string | null }>({ updatedAt: null });
  const [isNotesLoading, setNotesLoading] = useState(false);
  const [isNotesSaving, setNotesSaving] = useState(false);
  const [isNotesDirty, setNotesDirty] = useState(false);
  const [capitalEntries, setCapitalEntries] = useState<InvestingCapitalEntry[]>([]);
  const [capitalEntriesMeta, setCapitalEntriesMeta] = useState<{ updatedAt: string | null }>({
    updatedAt: null,
  });
  const [activities, setActivities] = useState<InvestingActivity[]>([]);
  const [activitiesSummary, setActivitiesSummary] = useState<InvestingActivityYearSummary[]>([]);
  const [activitiesMeta, setActivitiesMeta] = useState<{ updatedAt: string | null }>({ updatedAt: null });
  const [pickingRows, setPickingRows] = useState<InvestingPickingRow[]>([]);
  const [pickingMeta, setPickingMeta] = useState<{ updatedAt: string | null }>({ updatedAt: null });
  const [isPickingLoading, setPickingLoading] = useState(false);
  const [isPickingSaving, setPickingSaving] = useState(false);
  const [isPickingDirty, setPickingDirty] = useState(false);
  const [refills, setRefills] = useState<InvestingRefillRow[]>([]);
  const [operatingExpensesUsd, setOperatingExpensesUsdState] = useState("");
  const [refillsMeta, setRefillsMeta] = useState<{ updatedAt: string | null }>({ updatedAt: null });
  const [isRefillsLoading, setRefillsLoading] = useState(false);
  const [isRefillsSaving, setRefillsSaving] = useState(false);
  const [isRefillsDirty, setRefillsDirty] = useState(false);
  const [isActivitiesLoading, setActivitiesLoading] = useState(false);
  const [isActivitiesSaving, setActivitiesSaving] = useState(false);
  const [isActivitiesDirty, setActivitiesDirty] = useState(false);
  const [isCapitalEntriesLoading, setCapitalEntriesLoading] = useState(false);
  const [isCapitalEntriesDirty, setCapitalEntriesDirty] = useState(false);
  const [isCapitalEntriesSaving, setCapitalEntriesSaving] = useState(false);

  const [metrics, setMetricsState] = useState<{
    divYieldPercent: string;
    beta: string;
    allocationPercent: Record<string, string>;
  }>(() => {
    return { divYieldPercent: "—", beta: "—", allocationPercent: {} };
  });
  const [isMetricsLoading, setMetricsLoading] = useState(false);

  async function refreshHoldings() {
    if (!token) {
      setHoldings([]);
      setHoldingsMeta({ source: "default", updatedAt: null });
      setHoldingsDirty(false);
      return;
    }
    setHoldingsLoading(true);
    try {
      const res = await apiFetch<{ holdings: InvestingHolding[]; updated_at: string | null }>(
        "/investing/holdings",
        { token },
      );
      const persisted = normalizeHoldings(res.holdings);
      // Show persisted holdings right away; live quotes are applied when (and if) they arrive.
      setHoldings(persisted);
      setHoldingsMeta({ source: "server", updatedAt: res.updated_at });
      setHoldingsDirty(false);
      const uniqueTickers = Array.from(
        new Set(
          persisted
            .map((h) => (h.ticker ?? "").trim().toUpperCase())
            .filter((ticker) => ticker.length > 0),
        ),
      );
      if (uniqueTickers.length > 0) {
        void apiFetch<{
          prices: Record<string, number>;
          day_change_percent?: Record<string, number>;
        }>(`/investing/quotes?tickers=${encodeURIComponent(uniqueTickers.join(","))}`, { token })
          .then((quoteRes) =>
            setHoldings((prev) =>
              applyMarketPrices(prev, quoteRes.prices ?? {}, quoteRes.day_change_percent ?? {}),
            ),
          )
          .catch(() => {
            // Keep persisted holdings if quote provider is unavailable.
          });
      }
    } finally {
      setHoldingsLoading(false);
    }
  }

  async function refreshMarketPrices() {
    if (!token) return;
    const uniqueTickers = Array.from(
      new Set(
        holdings
          .map((h) => (h.ticker ?? "").trim().toUpperCase())
          .filter((ticker) => ticker.length > 0),
      ),
    );
    if (uniqueTickers.length === 0) return;
    setMarketPricesLoading(true);
    try {
      const res = await apiFetch<{
        prices: Record<string, number>;
        day_change_percent?: Record<string, number>;
      }>(`/investing/quotes?tickers=${encodeURIComponent(uniqueTickers.join(","))}`, { token });
      setHoldings((prev) =>
        applyMarketPrices(prev, res.prices ?? {}, res.day_change_percent ?? {}),
      );
      await refreshMetrics();
    } finally {
      setMarketPricesLoading(false);
    }
  }

  async function refreshCapitalEntries() {
    if (!token) {
      setCapitalEntries([]);
      setCapitalEntriesMeta({ updatedAt: null });
      setCapitalEntriesDirty(false);
      return;
    }
    setCapitalEntriesLoading(true);
    try {
      const res = await apiFetch<{ entries: InvestingCapitalEntry[]; updated_at: string | null }>(
        "/investing/capital-entries",
        { token },
      );
      setCapitalEntries(res.entries);
      setCapitalEntriesMeta({ updatedAt: res.updated_at ?? null });
      setCapitalEntriesDirty(false);
    } finally {
      setCapitalEntriesLoading(false);
    }
  }

  async function refreshActivities() {
    if (!token) {
      setActivities([]);
      setActivitiesSummary([]);
      setActivitiesMeta({ updatedAt: null });
      setActivitiesDirty(false);
      return;
    }
    setActivitiesLoading(true);
    try {
      const res = await apiFetch<{
        activities: InvestingActivity[];
        yearly_summary: InvestingActivityYearSummary[];
        updated_at: string | null;
      }>("/investing/activities", { token });
      setActivities(res.activities ?? []);
      setActivitiesSummary(res.yearly_summary ?? []);
      setActivitiesMeta({ updatedAt: res.updated_at ?? null });
      setActivitiesDirty(false);
    } finally {
      setActivitiesLoading(false);
    }
  }

  async function saveActivities() {
    if (!token || !isActivitiesDirty) return;
    setActivitiesSaving(true);
    try {
      const res = await apiFetch<{
        activities: InvestingActivity[];
        yearly_summary: InvestingActivityYearSummary[];
        updated_at: string | null;
      }>("/investing/activities", {
        token,
        method: "PUT",
        body: JSON.stringify({ activities }),
      });
      setActivities(res.activities ?? []);
      setActivitiesSummary(res.yearly_summary ?? []);
      setActivitiesMeta({ updatedAt: res.updated_at ?? null });
      setActivitiesDirty(false);
    } finally {
      setActivitiesSaving(false);
    }
  }

  async function refreshRefills() {
    if (!token) {
      setRefills([]);
      setOperatingExpensesUsdState("");
      setRefillsMeta({ updatedAt: null });
      setRefillsDirty(false);
      return;
    }
    setRefillsLoading(true);
    try {
      const res = await apiFetch<{
        rows: InvestingRefillRow[];
        operating_expenses_usd: string;
        updated_at: string | null;
      }>("/investing/refills", { token });
      setRefills(res.rows ?? []);
      setOperatingExpensesUsdState(res.operating_expenses_usd ?? "");
      setRefillsMeta({ updatedAt: res.updated_at ?? null });
      setRefillsDirty(false);
    } finally {
      setRefillsLoading(false);
    }
  }

  async function saveRefills() {
    if (!token || !isRefillsDirty) return;
    setRefillsSaving(true);
    try {
      const res = await apiFetch<{
        rows: InvestingRefillRow[];
        operating_expenses_usd: string;
        updated_at: string | null;
      }>("/investing/refills", {
        token,
        method: "PUT",
        body: JSON.stringify({
          rows: refills,
          operating_expenses_usd: operatingExpensesUsd,
        }),
      });
      setRefills(res.rows ?? []);
      setOperatingExpensesUsdState(res.operating_expenses_usd ?? "");
      setRefillsMeta({ updatedAt: res.updated_at ?? null });
      setRefillsDirty(false);
    } finally {
      setRefillsSaving(false);
    }
  }

  async function refreshPicking() {
    if (!token) {
      setPickingRows([]);
      setPickingMeta({ updatedAt: null });
      setPickingDirty(false);
      return;
    }
    setPickingLoading(true);
    try {
      const res = await apiFetch<{ rows: InvestingPickingRow[]; updated_at: string | null }>(
        "/investing/picking",
        { token },
      );
      setPickingRows(res.rows ?? []);
      setPickingMeta({ updatedAt: res.updated_at ?? null });
      setPickingDirty(false);
    } finally {
      setPickingLoading(false);
    }
  }

  async function savePicking() {
    if (!token || !isPickingDirty) return;
    setPickingSaving(true);
    try {
      const res = await apiFetch<{ rows: InvestingPickingRow[]; updated_at: string | null }>(
        "/investing/picking",
        {
          token,
          method: "PUT",
          body: JSON.stringify({ rows: pickingRows }),
        },
      );
      setPickingRows(res.rows ?? []);
      setPickingMeta({ updatedAt: res.updated_at ?? null });
      setPickingDirty(false);
    } finally {
      setPickingSaving(false);
    }
  }

  async function refreshNotes() {
    if (!token) {
      setNotesState("");
      setNotesMeta({ updatedAt: null });
      setNotesDirty(false);
      return;
    }
    setNotesLoading(true);
    try {
      const res = await apiFetch<{ notes: string; updated_at: string | null }>("/investing/notes", {
        token,
      });
      setNotesState(res.notes ?? "");
      setNotesMeta({ updatedAt: res.updated_at ?? null });
      setNotesDirty(false);
    } finally {
      setNotesLoading(false);
    }
  }

  async function saveNotes() {
    if (!token || !isNotesDirty) return;
    setNotesSaving(true);
    try {
      const res = await apiFetch<{ notes: string; updated_at: string | null }>("/investing/notes", {
        token,
        method: "PUT",
        body: JSON.stringify({ notes }),
      });
      setNotesState(res.notes ?? "");
      setNotesMeta({ updatedAt: res.updated_at ?? null });
      setNotesDirty(false);
    } finally {
      setNotesSaving(false);
    }
  }

  async function saveCapitalEntries() {
    if (!token || !isCapitalEntriesDirty) return;
    setCapitalEntriesSaving(true);
    try {
      const payload = capitalEntries.map((e) => ({
        id: e.id,
        date: e.date,
        deposit: e.deposit,
        total_value: e.total_value,
      }));
      const res = await apiFetch<{ entries: InvestingCapitalEntry[]; updated_at: string | null }>(
        "/investing/capital-entries",
        {
          token,
          method: "PUT",
          body: JSON.stringify({ entries: payload }),
        },
      );
      setCapitalEntries(res.entries);
      setCapitalEntriesMeta({ updatedAt: res.updated_at ?? null });
      setCapitalEntriesDirty(false);
    } finally {
      setCapitalEntriesSaving(false);
    }
  }

  async function saveHoldings() {
    if (!token) return;
    if (!isHoldingsDirty) return;
    setHoldingsSaving(true);
    try {
      const res = await apiFetch<{ updated_at: string | null }>("/investing/holdings", {
        token,
        method: "PUT",
        body: JSON.stringify({ holdings }),
      });
      setHoldingsMeta({ source: "server", updatedAt: res.updated_at ?? null });
      setHoldingsDirty(false);
      await refreshMetrics();
    } finally {
      setHoldingsSaving(false);
    }
  }

  /** Parses a spreadsheet server-side and merges it into the table as unsaved edits (Save persists to DB). */
  async function importHoldings(file: File): Promise<InvestingHoldingsImportSummary> {
    if (!token) throw { status: 401, message: "Not signed in" };
    const body = new FormData();
    body.append("file", file);
    const res = await apiFetch<{ rows: InvestingHoldingImportRow[]; skipped: string[] }>(
      "/investing/holdings/import",
      { token, method: "POST", body },
    );

    const byTicker = new Map(res.rows.map((r) => [r.ticker.toUpperCase(), r]));
    const added: string[] = [];
    const updated: string[] = [];
    const notInFile: string[] = [];
    const seen = new Set<string>();
    const merged = holdings.map((h) => {
      const ticker = (h.ticker ?? "").trim().toUpperCase();
      const row = byTicker.get(ticker);
      if (!row || seen.has(ticker)) {
        if (!row) notInFile.push(h.ticker);
        return h;
      }
      seen.add(ticker);
      updated.push(ticker);
      return {
        ...h,
        shares: row.shares,
        avgBuyPrice: formatUsd(row.avgBuyPrice),
        marketPrice: formatUsd(row.marketPrice),
        marketValue: formatUsd(row.marketValue),
      };
    });
    for (const row of res.rows) {
      const ticker = row.ticker.toUpperCase();
      if (seen.has(ticker)) continue;
      seen.add(ticker);
      added.push(ticker);
      merged.push({
        ...createEmptyHolding(),
        ticker,
        name: ticker,
        shares: row.shares,
        avgBuyPrice: formatUsd(row.avgBuyPrice),
        marketPrice: formatUsd(row.marketPrice),
        marketValue: formatUsd(row.marketValue),
      });
    }

    setHoldings(normalizeHoldings(merged));
    setHoldingsDirty(true);
    return { added, updated, notInFile, skipped: res.skipped ?? [] };
  }

  async function refreshMetrics() {
    if (!token) {
      setMetricsState({ divYieldPercent: "—", beta: "—", allocationPercent: {} });
      return;
    }
    setMetricsLoading(true);
    try {
      const res = await apiFetch<{
        div_yield_percent: string;
        beta: string;
        allocation_percent?: Record<string, string>;
      }>("/investing/metrics", { token });
      setMetricsState({
        divYieldPercent: res.div_yield_percent,
        beta: res.beta,
        allocationPercent: res.allocation_percent ?? {},
      });
    } finally {
      setMetricsLoading(false);
    }
  }

  async function updateMetrics(
    patch: Partial<{ divYieldPercent: string; beta: string; allocationPercent: Record<string, string> }>,
  ) {
    if (!token) return;
    const payload = {
      div_yield_percent: patch.divYieldPercent,
      beta: patch.beta,
    };
    const res = await apiFetch<{
      div_yield_percent: string;
      beta: string;
      allocation_percent?: Record<string, string>;
    }>("/investing/metrics", {
      token,
      method: "PUT",
      body: JSON.stringify(payload),
    });
    setMetricsState({
      divYieldPercent: res.div_yield_percent,
      beta: res.beta,
      allocationPercent: res.allocation_percent ?? {},
    });
  }

  useEffect(() => {
    void refreshHoldings().catch(() => {});
    void refreshActivities().catch(() => {});
    void refreshPicking().catch(() => {});
    void refreshCapitalEntries().catch(() => {});
    void refreshNotes().catch(() => {});
    void refreshMetrics().catch(() => {});
    void refreshRefills().catch(() => {});
  }, [token]);

  const store = useMemo<InvestingStore>(() => {
    return {
      holdings,
      holdingsMeta,
      capitalEntries,
      capitalEntriesMeta,
      activities,
      activitiesSummary,
      activitiesMeta,
      pickingRows,
      pickingMeta,
      isPickingLoading,
      isPickingSaving,
      isPickingDirty,
      refills,
      operatingExpensesUsd,
      refillsMeta,
      isRefillsLoading,
      isRefillsSaving,
      isRefillsDirty,
      isActivitiesLoading,
      isActivitiesSaving,
      isActivitiesDirty,
      isCapitalEntriesLoading,
      isCapitalEntriesDirty,
      isCapitalEntriesSaving,
      metrics,
      isMetricsLoading,
      isHoldingsLoading,
      isMarketPricesLoading,
      notes,
      notesMeta,
      isNotesLoading,
      isNotesSaving,
      isNotesDirty,
      isHoldingsDirty,
      isHoldingsSaving,
      updateHolding: (id, patch) => {
        setHoldingsDirty(true);
        setHoldings((prev) => normalizeHoldings(prev.map((h) => (h.id === id ? { ...h, ...patch } : h))));
      },
      addHolding: () => {
        setHoldingsDirty(true);
        setHoldings((prev) => normalizeHoldings([createEmptyHolding(), ...prev]));
      },
      deleteHolding: (id) => {
        setHoldingsDirty(true);
        setHoldings((prev) => normalizeHoldings(prev.filter((h) => h.id !== id)));
      },
      reset: () => {
        setHoldingsDirty(true);
        setHoldings([]);
      },
      updateCapitalEntry: (id, patch) => {
        setCapitalEntriesDirty(true);
        setCapitalEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
      },
      addCapitalEntry: () => {
        setCapitalEntriesDirty(true);
        setCapitalEntries((prev) => [
          ...prev,
          {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}`,
            date: "",
            deposit: "$0.00",
            total_value: "$0.00",
            roi_percent: "0.00%",
            one_year_percent: "0.00%",
          },
        ]);
      },
      deleteCapitalEntry: (id) => {
        setCapitalEntriesDirty(true);
        setCapitalEntries((prev) => prev.filter((e) => e.id !== id));
      },
      updateActivity: (id, patch) => {
        setActivitiesDirty(true);
        setActivities((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      },
      addActivity: (type) => {
        setActivitiesDirty(true);
        setActivities((prev) => [
          {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}`,
            type,
            name: "",
            ticker: "",
            category: "",
            count: 0,
            price: "0",
            currency: "USD",
            amount: "0",
            gains_losses: "0",
            commission: "0",
            date: "",
          },
          ...prev,
        ]);
      },
      deleteActivity: (id) => {
        setActivitiesDirty(true);
        setActivities((prev) => prev.filter((a) => a.id !== id));
      },
      updatePickingRow: (id, patch) => {
        setPickingDirty(true);
        setPickingRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      },
      addPickingRow: () => {
        setPickingDirty(true);
        setPickingRows((prev) => [
          {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}`,
            bucket: "value_blue_chips",
            name: "",
            ticker: "",
            industry: "",
            pe: "",
            eps: "",
            beta: "",
            div_yield: "",
            current_price: "",
            day_change_pct: "",
            strong_buy_until: "",
            may_buy_until: "",
            buy_right_now: "",
            price_goal_1y: "",
            price_goal_5y: "",
            notes: "",
          },
          ...prev,
        ]);
      },
      deletePickingRow: (id) => {
        setPickingDirty(true);
        setPickingRows((prev) => prev.filter((r) => r.id !== id));
      },
      refreshPicking,
      savePicking,
      updateRefill: (id, patch) => {
        setRefillsDirty(true);
        setRefills((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      },
      addRefill: () => {
        setRefillsDirty(true);
        setRefills((prev) => [
          {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}`,
            date: "",
            amount: "",
            commission: "",
          },
          ...prev,
        ]);
      },
      deleteRefill: (id) => {
        setRefillsDirty(true);
        setRefills((prev) => prev.filter((r) => r.id !== id));
      },
      setOperatingExpensesUsd: (value) => {
        setRefillsDirty(true);
        setOperatingExpensesUsdState(value);
      },
      refreshRefills,
      saveRefills,
      refreshActivities,
      saveActivities,
      refreshCapitalEntries,
      saveCapitalEntries,
      refreshHoldings,
      refreshMarketPrices,
      saveHoldings,
      importHoldings,
      setNotes: (next) => {
        setNotesState(next);
        setNotesDirty(true);
      },
      refreshNotes,
      saveNotes,
      refreshMetrics,
      updateMetrics,
    };
  }, [
    holdings,
    holdingsMeta,
    capitalEntries,
    capitalEntriesMeta,
    activities,
    activitiesSummary,
    activitiesMeta,
    pickingRows,
    pickingMeta,
    isPickingLoading,
    isPickingSaving,
    isPickingDirty,
    refills,
    operatingExpensesUsd,
    refillsMeta,
    isRefillsLoading,
    isRefillsSaving,
    isRefillsDirty,
    isActivitiesLoading,
    isActivitiesSaving,
    isActivitiesDirty,
    isCapitalEntriesLoading,
    isCapitalEntriesDirty,
    isCapitalEntriesSaving,
    metrics,
    isMetricsLoading,
    isHoldingsLoading,
    isMarketPricesLoading,
    notes,
    notesMeta,
    isNotesLoading,
    isNotesSaving,
    isNotesDirty,
    isHoldingsDirty,
    isHoldingsSaving,
  ]);

  return <InvestingContext.Provider value={store}>{children}</InvestingContext.Provider>;
}

export function useInvesting() {
  const ctx = useContext(InvestingContext);
  if (!ctx) throw new Error("useInvesting must be used within InvestingProvider");
  return ctx;
}

