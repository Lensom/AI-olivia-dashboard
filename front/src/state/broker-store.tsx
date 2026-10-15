"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { parseCryptoAmount } from "@/features/investing/crypto-format";
import { parseInvestingDateMs } from "@/features/investing/format";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./auth-store";

export type BrokerCashBalance = { id: string; currency: string; amount: string };
export type BrokerDividend = {
  id: string;
  date: string;
  ticker: string;
  amount: string;
  tax: string;
  currency: string;
  /** Calculated by the API at the payment date's rate; refreshed on save. */
  amount_usd: number;
  tax_usd: number;
};
export type AttentionRules = {
  max_fees_pct: number;
  min_annual_return_pct: number;
  etf_min_pct: number;
  etf_max_pct: number;
  drift_pp: number;
  max_position_pct: number;
  max_cash_pct: number;
};

type BrokerData = { cash: BrokerCashBalance[]; dividends: BrokerDividend[]; rules: AttentionRules };

export const DEFAULT_RULES: AttentionRules = {
  max_fees_pct: 3.5,
  min_annual_return_pct: 6,
  etf_min_pct: 40,
  etf_max_pct: 50,
  drift_pp: 5,
  max_position_pct: 25,
  max_cash_pct: 5,
};

type BrokerStore = BrokerData & {
  /** Uninvested broker cash in USD (non-USD balances at official NBU rates). */
  cashUsd: number;
  updatedAt: string | null;
  isLoaded: boolean;
  isDirty: boolean;
  isSaving: boolean;
  setCash: (fn: (rows: BrokerCashBalance[]) => BrokerCashBalance[]) => void;
  setDividends: (fn: (rows: BrokerDividend[]) => BrokerDividend[]) => void;
  /** Saves immediately (thresholds are small, standalone settings). */
  saveRules: (rules: AttentionRules) => Promise<void>;
  save: () => Promise<void>;
};

const BrokerContext = createContext<BrokerStore | null>(null);

export function newBrokerId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
}

export function BrokerProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [data, setData] = useState<BrokerData>({ cash: [], dividends: [], rules: DEFAULT_RULES });
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [isLoaded, setLoaded] = useState(false);
  const [isDirty, setDirty] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [rates, setRates] = useState<Record<string, number>>({ USD: 1 });
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  // Last state the server confirmed, so saving the rules never saves pending cash/dividend edits.
  const savedRef = useRef<BrokerData>({ cash: [], dividends: [], rules: DEFAULT_RULES });

  useEffect(() => {
    if (!token) return;
    apiFetch<BrokerData & { updated_at: string | null }>("/investing/broker", { token })
      .then((res) => {
        const next = { cash: res.cash, dividends: res.dividends, rules: { ...DEFAULT_RULES, ...res.rules } };
        savedRef.current = next;
        setData(next);
        setUpdatedAt(res.updated_at);
        setDirty(false);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [token]);

  const currencyKey = useMemo(
    () => [...new Set(data.cash.map((c) => c.currency.trim().toUpperCase()).filter((c) => c && c !== "USD"))].sort().join(","),
    [data.cash],
  );
  useEffect(() => {
    if (!token || !currencyKey) return;
    apiFetch<{ to_usd: Record<string, number> }>("/investing/rates", { token })
      .then((r) => setRates({ USD: 1, ...r.to_usd }))
      .catch(() => {});
  }, [token, currencyKey]);

  const cashUsd = useMemo(
    () =>
      data.cash.reduce((a, c) => {
        const rate = rates[c.currency.trim().toUpperCase() || "USD"] ?? 0;
        return a + parseCryptoAmount(c.amount) * rate;
      }, 0),
    [data.cash, rates],
  );

  const put = useCallback(
    async (body: BrokerData): Promise<BrokerData | null> => {
      if (!token) return null;
      const res = await apiFetch<BrokerData & { updated_at: string | null }>("/investing/broker", {
        token,
        method: "PUT",
        body: JSON.stringify(body),
      });
      const saved = { cash: res.cash, dividends: res.dividends, rules: { ...DEFAULT_RULES, ...res.rules } };
      savedRef.current = saved;
      setUpdatedAt(res.updated_at);
      return saved;
    },
    [token],
  );

  const store = useMemo<BrokerStore>(
    () => ({
      ...data,
      cashUsd,
      updatedAt,
      isLoaded,
      isDirty,
      isSaving,
      setCash: (fn) => {
        setData((d) => ({ ...d, cash: fn(d.cash) }));
        setDirty(true);
      },
      setDividends: (fn) => {
        setData((d) => ({ ...d, dividends: fn(d.dividends) }));
        setDirty(true);
      },
      saveRules: async (rules) => {
        // Saved on top of the last confirmed cash/dividends; local unsaved edits stay pending.
        await put({ ...savedRef.current, rules });
        setData((d) => ({ ...d, rules }));
      },
      save: async () => {
        setSaving(true);
        try {
          // Newest first; rows without a readable date stay on top so they're easy to fix.
          const ms = (d: BrokerDividend) => parseInvestingDateMs(d.date) ?? Infinity;
          const dividends = [...dataRef.current.dividends].sort((a, b) => ms(b) - ms(a));
          const saved = await put({ ...dataRef.current, dividends });
          if (saved) setData(saved); // brings back the USD amounts calculated server-side
          setDirty(false);
        } finally {
          setSaving(false);
        }
      },
    }),
    [data, cashUsd, updatedAt, isLoaded, isDirty, isSaving, put],
  );

  return <BrokerContext.Provider value={store}>{children}</BrokerContext.Provider>;
}

export function useBroker() {
  const ctx = useContext(BrokerContext);
  if (!ctx) throw new Error("useBroker must be used within BrokerProvider");
  return ctx;
}
