import { parseCryptoAmount } from "@/features/investing/crypto-format";

/** Mirrors TotalAccount in back/app/investing/schemas.py. */
export type TotalCategory = "stocks" | "savings" | "crypto" | "owed_to_me" | "i_owe";
export type TotalSource = "manual" | "stocks" | "crypto";
export type TotalAccount = {
  id: string;
  name: string;
  category: TotalCategory;
  amount: string;
  currency: string;
  source: TotalSource;
};

export type LiveValues = { stocks: number; crypto: number };

/** USD value of one account: live sources use the app's values, typed ones convert at `rateFor` (null = no rate). */
export function accountUsd(
  a: TotalAccount,
  live: LiveValues,
  rateFor: (currency: string) => number | null,
): { usd: number; live: boolean; missingRate: boolean } {
  if (a.source === "stocks") return { usd: live.stocks, live: true, missingRate: false };
  if (a.source === "crypto") return { usd: live.crypto, live: true, missingRate: false };
  const rate = rateFor(a.currency);
  return { usd: rate != null ? parseCryptoAmount(a.amount) * rate : 0, live: false, missingRate: rate == null };
}

export type TotalSums = { by: Record<TotalCategory, number>; assets: number; net: number };

/** Per-category sums; net worth = stocks + savings + crypto + owed to me − I owe. */
export function totalSums(rows: { category: TotalCategory; usd: number }[]): TotalSums {
  const by: Record<TotalCategory, number> = { stocks: 0, savings: 0, crypto: 0, owed_to_me: 0, i_owe: 0 };
  for (const r of rows) by[r.category] += r.usd;
  const assets = by.stocks + by.savings + by.crypto;
  return { by, assets, net: assets + by.owed_to_me - by.i_owe };
}
