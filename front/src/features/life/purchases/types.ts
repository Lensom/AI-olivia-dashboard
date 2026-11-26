/** Life → Purchases (back/app/purchases/router.py): lists of things to buy and bought, each item in its own currency. */

export type Currency = "UAH" | "EUR" | "USD" | "RON" | "PLN" | "GBP";
export const CURRENCIES: Currency[] = ["UAH", "EUR", "USD", "RON", "PLN", "GBP"];

export type Purchase = {
  id: string;
  title: string;
  category: string;
  bought: boolean;
  planned: number | null;
  /** What it cost; 0 is a gift or free. */
  paid: number | null;
  currency: Currency;
  url: string;
  store: string;
  note: string;
};

export type PurchaseList = { id: string; title: string; currency: Currency; items: Purchase[] };
export type Purchases = { lists: PurchaseList[] };

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

/** The backend refuses anything else; checking here keeps the form from sending it. */
export const isWebLink = (s: string) => /^https?:\/\/[^\s"'<>]+$/i.test(s.trim());

export const newPurchase = (title: string, currency: Currency): Purchase => ({
  id: newId(),
  title,
  category: "",
  bought: false,
  planned: null,
  paid: null,
  currency,
  url: "",
  store: "",
  note: "",
});

/** "18 999 ₴", "10,81 €": no decimals when there are none. */
export function formatMoney(amount: number, currency: Currency, locale: string): string {
  const whole = Number.isInteger(Math.round(amount * 100) / 100) && Math.round(amount) === amount;
  return new Intl.NumberFormat(locale === "uk" ? "uk-UA" : "en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Totals kept apart by currency: adding hryvnias to euros was the problem with the Notion page. */
export function sumByCurrency(items: readonly Purchase[], pick: (p: Purchase) => number | null): Map<Currency, number> {
  const out = new Map<Currency, number>();
  for (const p of items) {
    const v = pick(p);
    if (v != null) out.set(p.currency, (out.get(p.currency) ?? 0) + v);
  }
  return out;
}

/** USD per one unit of each currency (GET /investing/rates, NBU). */
export type Rates = Record<string, number>;

/** One figure in `to`, or null while a rate is missing (it is then left out rather than counted as 0). */
export function convertTotal(sums: Map<Currency, number>, to: Currency, rates: Rates | null): number | null {
  if (!rates?.[to]) return null;
  let total = 0;
  for (const [cur, amount] of sums) {
    const r = rates[cur];
    if (!r) return null;
    total += (amount * r) / rates[to];
  }
  return total;
}

/** What you saved against the planned price, per currency: only items bought with both prices known. */
export const savedByCurrency = (items: readonly Purchase[]) =>
  sumByCurrency(
    items.filter((p) => p.bought && p.planned != null && p.paid != null),
    (p) => (p.planned as number) - (p.paid as number),
  );

// ---- Import: the Notion export (title / purchased / plannedPrice / purchasedFor / link / store) or this page's own ----

type NotionItem = {
  title?: unknown;
  category?: unknown;
  purchased?: unknown;
  plannedPrice?: unknown;
  purchasedFor?: unknown;
  link?: unknown;
  store?: unknown;
  note?: unknown;
};
type NotionList = { id?: unknown; title?: unknown; items?: unknown };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const money = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000 ? v : null);
const listId = (v: unknown) => {
  const s = typeof v === "string" ? v.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) : "";
  return s || newId();
};

/** The lists in a pasted file, with how many items each has: the import shows them to pick a currency per list. */
export function readLists(data: unknown): { id: string; title: string; count: number; raw: NotionList }[] | null {
  const lists = (data as { lists?: unknown })?.lists;
  if (!Array.isArray(lists)) return null;
  const out = lists
    .filter((l): l is NotionList => !!l && typeof l === "object" && Array.isArray((l as NotionList).items))
    .map((l) => ({ id: listId(l.id), title: str(l.title, 100) || "List", count: (l.items as unknown[]).length, raw: l }));
  return out.length ? out : null;
}

/** A file's lists as this page's lists. Items that carry their own currency (this page's export) keep it; the others
 *  get the one picked for their list, since the Notion page didn't record it. */
export function importLists(lists: NonNullable<ReturnType<typeof readLists>>, currencyFor: (listId: string) => Currency): PurchaseList[] {
  return lists.map((l) => {
    const currency = currencyFor(l.id);
    const items = (l.raw.items as unknown[])
      .filter((i): i is NotionItem & Partial<Purchase> => !!i && typeof i === "object")
      .map((i) => {
        const own = CURRENCIES.includes(i.currency as Currency) ? (i.currency as Currency) : null;
        const url = str(i.link ?? i.url, 2000);
        return {
          id: newId(),
          title: str(i.title, 300),
          category: str(i.category, 100),
          bought: i.purchased === true || i.bought === true,
          planned: money(i.plannedPrice ?? i.planned),
          paid: money(i.purchasedFor ?? i.paid),
          currency: own ?? currency,
          url: isWebLink(url) ? url : "",
          store: str(i.store, 100),
          note: str(i.note, 2000),
        };
      })
      .filter((i) => i.title)
      .slice(0, 500);
    return { id: l.id, title: l.title, currency, items };
  });
}

/** A first guess at a list's currency, from what the Notion page said: tech and the computer in hryvnias, collectables
 *  in euros. Shown in the import to change before importing. */
export function guessCurrency(listId: string): Currency {
  return ["comics", "figures", "lego"].includes(listId) ? "EUR" : "UAH";
}
