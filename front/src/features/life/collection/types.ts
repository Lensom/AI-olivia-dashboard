/** Mirrors back/app/collection/router.py. */
export type Status = "idea" | "collecting" | "done" | "dropped";
export type Currency = "UAH" | "USD" | "EUR";
export type Wish = { id: string; title: string; url: string; price: number | null; currency: Currency; bought: boolean };
export type Piece = {
  id: string;
  title: string;
  note: string;
  url: string;
  status: Status;
  count: number | null;
  goal: number | null;
  wishes: Wish[];
};
export type Item = Piece & { children: Piece[] };
export type Category = { id: string; name: string; items: Item[] };
export type Collection = { categories: Category[] };

/** Same colours as the Notion page it replaces: yellow in progress, green done, red no, plain still to decide. */
export const STATUSES: { value: Status; label: string; pill: string; dot: string }[] = [
  { value: "collecting", label: "Collecting now", pill: "bg-amber-100 text-amber-900", dot: "bg-amber-400" },
  { value: "done", label: "Collected", pill: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  { value: "idea", label: "To decide", pill: "bg-[#f1ece2] text-[#5f574b]", dot: "bg-[#cfc6b6]" },
  { value: "dropped", label: "Declined", pill: "bg-rose-100 text-rose-800", dot: "bg-rose-400" },
];
export const statusMeta = (s: Status) => STATUSES.find((x) => x.value === s) ?? STATUSES[2];

export const CURRENCIES: Currency[] = ["UAH", "USD", "EUR"];

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`);

/** The backend refuses anything else; checking here keeps the form from sending it. */
export const isWebLink = (s: string) => /^https?:\/\/[^\s"'<>]+$/i.test(s.trim());

export const newPiece = (title: string): Piece => ({ id: newId(), title, note: "", url: "", status: "idea", count: null, goal: null, wishes: [] });

/** Every line of a category, sub-lines included. */
export const piecesOf = (c: Category): Piece[] => c.items.flatMap((i) => [i, ...i.children]);

/** Changes the line with this id wherever it is; returning null removes it (with its sub-lines). */
export function mapPiece(col: Collection, id: string, fn: (p: Piece) => Piece | null): Collection {
  const each = <T extends Piece>(list: T[]): T[] =>
    list.flatMap((p) => {
      if (p.id !== id) return [p];
      const next = fn(p);
      return next ? [next as T] : [];
    });
  return { categories: col.categories.map((c) => ({ ...c, items: each(c.items).map((i) => ({ ...i, children: each(i.children) })) })) };
}

function shift<T extends { id: string }>(list: T[], id: string, dir: -1 | 1): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Moves a line, or a category, one place up or down among its neighbours. */
export function move(col: Collection, id: string, dir: -1 | 1): Collection {
  return {
    categories: shift(col.categories, id, dir).map((c) => ({ ...c, items: shift(c.items, id, dir).map((i) => ({ ...i, children: shift(i.children, id, dir) })) })),
  };
}

/** Lower case, no accents or punctuation, ґ = г. */
export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ґ/g, "г")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
