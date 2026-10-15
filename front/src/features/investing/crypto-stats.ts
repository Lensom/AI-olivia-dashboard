import { parseCryptoAmount } from "@/features/investing/crypto-format";
import type { CryptoHoldingRow, CryptoPurchaseRow, CryptoRefillRow, CryptoRules } from "@/state/crypto-store";

/** The purchase history tracks BTC and ETH legs only. */
export type TrackedCoin = "BTC" | "ETH";

export function trackedCoin(symbol: string): TrackedCoin | null {
  const s = symbol.trim().toUpperCase().replace(/-USD$/, "");
  return s === "BTC" || s === "ETH" ? s : null;
}

export type CoinHistory = { spent: number; coins: number; avgPrice: number | null; buys: number };

/** USD spent, coins bought (usd / price) and average buy price for one coin, from rows with both values. */
export function coinHistory(rows: CryptoPurchaseRow[], coin: TrackedCoin): CoinHistory {
  const usdKey = coin === "BTC" ? "btc_usd" : "eth_usd";
  const priceKey = coin === "BTC" ? "btc_price" : "eth_price";
  let spent = 0;
  let coins = 0;
  let buys = 0;
  for (const r of rows) {
    const usd = parseCryptoAmount(r[usdKey]);
    const price = parseCryptoAmount(r[priceKey]);
    if (usd <= 0 || price <= 0) continue;
    spent += usd;
    coins += usd / price;
    buys += 1;
  }
  return { spent, coins, avgPrice: coins > 0 ? spent / coins : null, buys };
}

export type CoinPosition = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  price: number | null;
  value: number;
  dayPct: number | null;
  dayUsd: number | null;
  weight: number;
  /** From purchase history; null for coins the history doesn't track. */
  history: CoinHistory | null;
  /** Cost of the coins held, at the historical average price. */
  cost: number | null;
  pnl: number | null;
  pnlPct: number | null;
  /** Current price vs average buy, %: negative means cheaper than you usually paid. */
  priceVsAvgPct: number | null;
};

export function buildCoinPositions(holdings: CryptoHoldingRow[], purchases: CryptoPurchaseRow[]): CoinPosition[] {
  const base = holdings
    .filter((h) => h.symbol.trim())
    .map((h) => {
      const quantity = parseCryptoAmount(h.quantity);
      const priceRaw = parseCryptoAmount(String(h.quoteUsd ?? ""));
      const price = priceRaw > 0 ? priceRaw : null;
      const value = price != null ? price * quantity : 0;
      const dayRaw = Number.parseFloat(String(h.dayChangePct ?? "").replace("%", ""));
      const dayPct = Number.isFinite(dayRaw) ? dayRaw : null;
      const coin = trackedCoin(h.symbol);
      const history = coin ? coinHistory(purchases, coin) : null;
      const avg = history?.avgPrice ?? null;
      const cost = avg != null ? avg * quantity : null;
      const pnl = cost != null && price != null ? value - cost : null;
      return {
        id: h.id,
        symbol: h.symbol.trim().toUpperCase(),
        name: h.name,
        quantity,
        price,
        value,
        dayPct,
        dayUsd: dayPct != null ? value - value / (1 + dayPct / 100) : null,
        weight: 0,
        history,
        cost,
        pnl,
        pnlPct: pnl != null && cost ? (pnl / cost) * 100 : null,
        priceVsAvgPct: avg != null && price != null ? (price / avg - 1) * 100 : null,
      };
    });
  const total = base.reduce((a, p) => a + p.value, 0);
  return base.map((p) => ({ ...p, weight: total > 0 ? (p.value / total) * 100 : 0 }));
}

export type CryptoTotals = {
  value: number;
  dayUsd: number;
  dayPct: number;
  /** USD that arrived from UAH funding. */
  funded: number;
  /** USD spent on BTC/ETH purchases. */
  spent: number;
  /** Funded − spent: exchange spread/fees or cash not yet used. */
  notSpent: number;
  /** Value − funded: the honest return on money put in. */
  pnl: number;
  pnlPct: number;
};

export function buildCryptoTotals(
  positions: CoinPosition[],
  refills: CryptoRefillRow[],
  purchases: CryptoPurchaseRow[],
): CryptoTotals {
  const value = positions.reduce((a, p) => a + p.value, 0);
  const dayUsd = positions.reduce((a, p) => a + (p.dayUsd ?? 0), 0);
  const funded = refills.reduce((a, r) => a + parseCryptoAmount(r.usd), 0);
  const spent = coinHistory(purchases, "BTC").spent + coinHistory(purchases, "ETH").spent;
  return {
    value,
    dayUsd,
    dayPct: value - dayUsd > 0 ? (dayUsd / (value - dayUsd)) * 100 : 0,
    funded,
    spent,
    notSpent: funded - spent,
    pnl: value - funded,
    pnlPct: funded > 0 ? ((value - funded) / funded) * 100 : 0,
  };
}

/** BTC share of the rule, normalized so BTC + ETH = 100 (the rule fields needn't add up). */
export function ruleBtcShare(rules: CryptoRules): number {
  const b = parseCryptoAmount(rules.btc_percent);
  const e = parseCryptoAmount(rules.eth_percent);
  return b + e > 0 ? b / (b + e) : 0.7;
}

/**
 * Split of a new deposit that moves the BTC/ETH mix toward the rule. All of it goes to the under-weight
 * coin until the target is reached; whatever is left follows the rule ratio.
 */
export function rebalancingSplit(deposit: number, btcValue: number, ethValue: number, btcShare: number) {
  const total = btcValue + ethValue + deposit;
  const btc = Math.min(deposit, Math.max(0, btcShare * total - btcValue));
  return { btc, eth: deposit - btc };
}
