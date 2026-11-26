"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import {
  CURRENCIES,
  convertTotal,
  formatMoney,
  guessCurrency,
  importLists,
  isWebLink,
  newId,
  newPurchase,
  readLists,
  savedByCurrency,
  sumByCurrency,
  type Currency,
  type Purchase,
  type PurchaseList,
  type Purchases,
  type Rates,
} from "@/features/life/purchases/types";
import { apiFetch } from "@/lib/api";
import { filterSearch } from "@/lib/filter-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const card = "overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const field = "min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/25";
const btn = "rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm font-medium text-[#3b352d] hover:bg-[#faf8f2]";
const chip = (on: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`;

type Show = "all" | "to_buy" | "bought";
type Edit = (change: (d: Purchases) => Purchases) => void;
const SHOW_KEY = "olivia.purchases.currency";

/** "20 300 ₴ · 459 €": one sum per currency, in the order of CURRENCIES. */
function useSums() {
  const locale = useLocale();
  return (sums: Map<Currency, number>) =>
    CURRENCIES.filter((c) => sums.has(c))
      .map((c) => formatMoney(sums.get(c)!, c, locale))
      .join(" · ");
}

const parseMoney = (v: string): number | null | "bad" => {
  const s = v.trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000_000 ? n : "bad";
};

function PurchasesPage({ initialQuery }: { initialQuery: string }) {
  const t = useT();
  const locale = useLocale();
  const { token } = useAuth();
  const sums = useSums();
  const [data, setData] = useState<Purchases>({ lists: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [ratesDate, setRatesDate] = useState<string | null>(null);
  const [showIn, setShowIn] = useState<Currency>(() => {
    if (typeof window === "undefined") return "UAH";
    const saved = window.localStorage.getItem(SHOW_KEY);
    return CURRENCIES.includes(saved as Currency) ? (saved as Currency) : "UAH";
  });
  const [show, setShow] = useState<Show>("all");
  const [query, setQuery] = useState(initialQuery);
  const [editing, setEditing] = useState<{ item: Purchase; listId: string; isNew: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  const latest = useRef<Purchases>({ lists: [] });

  useEffect(() => {
    if (!token) return;
    apiFetch<Purchases>("/life/purchases", { token })
      .then((d) => {
        latest.current = { lists: d.lists };
        setData(latest.current);
      })
      .catch(() => setError("Could not load your purchases. Is the backend running?"))
      .finally(() => setLoaded(true));
    // Official NBU rates, for the overall figure; the per-currency sums don't need them.
    apiFetch<{ to_usd: Rates; date: string | null }>("/investing/rates", { token })
      .then((r) => {
        setRates(r.to_usd);
        setRatesDate(r.date);
      })
      .catch(() => setRates(null));
  }, [token]);

  useEffect(() => {
    window.localStorage.setItem(SHOW_KEY, showIn);
  }, [showIn]);

  /** Applies a change right away and saves it; puts the lists back if saving fails. */
  const edit: Edit = (change) => {
    const prev = latest.current;
    const next = change(prev);
    latest.current = next;
    setData(next);
    apiFetch("/life/purchases", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) })
      .then(() => setError(null))
      .catch(() => {
        if (latest.current === next) {
          latest.current = prev;
          setData(prev);
        }
        setError("Could not save — the change was undone.");
      });
  };
  const editList = (listId: string, change: (l: PurchaseList) => PurchaseList) =>
    edit((d) => ({ lists: d.lists.map((l) => (l.id === listId ? change(l) : l)) }));

  const all = useMemo(() => data.lists.flatMap((l) => l.items), [data]);
  const q = query.trim().toLowerCase();
  const matches = (p: Purchase) =>
    (show === "all" || (show === "bought") === p.bought) &&
    (!q || [p.title, p.category, p.store, p.note].some((s) => s.toLowerCase().includes(q)));
  const counts = useMemo(() => ({ all: all.length, bought: all.filter((p) => p.bought).length }), [all]);

  const spent = sumByCurrency(all.filter((p) => p.bought), (p) => p.paid);
  const toBuy = sumByCurrency(all.filter((p) => !p.bought), (p) => p.planned);
  const saved = savedByCurrency(all);
  const totalIn = (s: Map<Currency, number>) => {
    const v = convertTotal(s, showIn, rates);
    return v == null ? (s.size ? null : formatMoney(0, showIn, locale)) : formatMoney(Math.round(v), showIn, locale);
  };

  const save = (item: Purchase, listId: string) => {
    edit((d) => {
      const without = d.lists.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== item.id) }));
      return {
        lists: without.map((l) => {
          if (l.id !== listId) return l;
          const at = d.lists.find((x) => x.id === listId)?.items.findIndex((i) => i.id === item.id) ?? -1;
          const items = [...l.items];
          items.splice(at >= 0 ? at : items.length, 0, item);
          return { ...l, items };
        }),
      };
    });
    setEditing(null);
  };

  const addList = () => {
    const title = window.prompt(t("Name of the new list"))?.trim();
    if (!title) return;
    edit((d) => ({ lists: [...d.lists, { id: newId(), title: title.slice(0, 100), currency: showIn, items: [] }] }));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Purchases")}</h1>
          <p className="mt-1 text-sm text-[#6f675b]">{t("What you plan to buy and what you bought, each price in its own currency.")}</p>
        </div>
        {loaded ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setImporting(true)} className={btn}>
              {t("Import JSON")}
            </button>
            <button type="button" onClick={addList} className="rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-sm font-medium text-[#f8f4eb] hover:bg-black">
              + {t("New list")}
            </button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert">
          {t(error)}
        </p>
      ) : null}

      {!loaded ? (
        <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>
      ) : data.lists.length === 0 ? (
        <div className={`${card} space-y-3 p-6 text-sm text-[#6f675b]`}>
          <p>{t("No lists yet. Import your Notion export, or start a list of your own.")}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setImporting(true)} className={btn}>
              {t("Import JSON")}
            </button>
            <button type="button" onClick={addList} className={btn}>
              + {t("New list")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3" aria-label={t("Totals")}>
            {[
              { label: t("Spent"), sums: spent, sub: t("{n} bought", { n: counts.bought }) },
              { label: t("Still to buy"), sums: toBuy, sub: t("planned prices of {n} items", { n: counts.all - counts.bought }) },
              { label: t("Saved against plan"), sums: saved, sub: t("planned minus paid, for what you bought") },
            ].map((c) => (
              <div key={c.label} className={`${card} p-4`}>
                <p className="text-xs font-medium text-[#8f8676]">{c.label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">{totalIn(c.sums) ?? "—"}</p>
                <p className="mt-1 text-xs tabular-nums text-[#6f675b]">{c.sums.size > 1 || (c.sums.size === 1 && !c.sums.has(showIn)) ? sums(c.sums) : c.sub}</p>
              </div>
            ))}
          </section>
          <p className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-[#8f8676]">
            <label className="inline-flex items-center gap-1.5">
              {t("Totals in")}
              <select value={showIn} onChange={(e) => setShowIn(e.target.value as Currency)} className="h-7 rounded-full border border-black/10 bg-white px-2 text-xs text-[#3b352d]" aria-label={t("Totals in")}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <span>{rates ? t("at NBU rates of {date}", { date: ratesDate ?? "" }) : t("Exchange rates are unavailable: totals are shown per currency.")}</span>
          </p>

          <section className="space-y-2.5" aria-label={t("Filters")}>
            <div className="flex flex-wrap items-center gap-2">
              <div className="scroll-row flex grow basis-full gap-1.5 sm:contents" role="group" aria-label={t("Show")}>
                {(
                  [
                    ["all", t("All"), counts.all],
                    ["to_buy", t("To buy"), counts.all - counts.bought],
                    ["bought", t("Bought"), counts.bought],
                  ] as const
                ).map(([value, label, n]) => (
                  <button key={value} type="button" onClick={() => setShow(value)} aria-pressed={show === value} className={chip(show === value)}>
                    {label} <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
              </div>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search purchases…")} aria-label={t("Search purchases…")} className={filterSearch} />
            </div>
          </section>

          {data.lists.map((list, index) => (
            <ListCard
              key={list.id}
              list={list}
              index={index}
              total={data.lists.length}
              items={list.items.filter(matches)}
              filtering={show !== "all" || !!q}
              onEditList={(change) => editList(list.id, change)}
              onMove={(dir) =>
                edit((d) => {
                  const lists = [...d.lists];
                  const [moved] = lists.splice(index, 1);
                  lists.splice(index + dir, 0, moved);
                  return { lists };
                })
              }
              onDelete={() => {
                if (list.items.length && !window.confirm(t("Delete the list \"{title}\" with its {n} items?", { title: list.title, n: list.items.length }))) return;
                edit((d) => ({ lists: d.lists.filter((l) => l.id !== list.id) }));
              }}
              onOpen={(item) => setEditing({ item, listId: list.id, isNew: false })}
            />
          ))}
        </>
      )}

      {editing ? (
        <ItemDialog
          editing={editing}
          lists={data.lists}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={() => {
            edit((d) => ({ lists: d.lists.map((l) => ({ ...l, items: l.items.filter((i) => i.id !== editing.item.id) })) }));
            setEditing(null);
          }}
        />
      ) : null}
      {importing ? (
        <ImportDialog
          hasData={data.lists.length > 0}
          onClose={() => setImporting(false)}
          onImport={(lists, replace) => {
            edit((d) => ({ lists: replace ? lists : [...d.lists, ...lists.map((l) => (d.lists.some((x) => x.id === l.id) ? { ...l, id: newId() } : l))] }));
            setImporting(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ListCard({
  list,
  index,
  total,
  items,
  filtering,
  onEditList,
  onMove,
  onDelete,
  onOpen,
}: {
  list: PurchaseList;
  index: number;
  total: number;
  items: Purchase[];
  filtering: boolean;
  onEditList: (change: (l: PurchaseList) => PurchaseList) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onOpen: (item: Purchase) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const sums = useSums();
  const [adding, setAdding] = useState("");
  const iconBtn = "rounded px-1.5 py-0.5 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17] disabled:opacity-30";
  if (filtering && !items.length) return null;
  const money = (v: number | null, c: Currency) => (v == null ? "—" : formatMoney(v, c, locale));
  const planned = sumByCurrency(items, (p) => p.planned);
  const paid = sumByCurrency(items.filter((p) => p.bought), (p) => p.paid);

  return (
    <section className={card} aria-label={list.title}>
      <header className="flex flex-wrap items-center gap-2 border-b border-black/5 px-4 py-3">
        <h2 className="text-lg font-semibold text-[#1f1c17]">{list.title}</h2>
        <span className="text-xs tabular-nums text-[#8f8676]">
          {list.items.filter((i) => i.bought).length}/{list.items.length}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className={iconBtn}
            title={t("Rename")}
            aria-label={t("Rename")}
            onClick={() => {
              const title = window.prompt(t("Rename"), list.title)?.trim();
              if (title) onEditList((l) => ({ ...l, title: title.slice(0, 100) }));
            }}
          >
            ✎
          </button>
          <button type="button" className={iconBtn} disabled={index === 0} onClick={() => onMove(-1)} title={t("Move up")} aria-label={t("Move up")}>
            ↑
          </button>
          <button type="button" className={iconBtn} disabled={index === total - 1} onClick={() => onMove(1)} title={t("Move down")} aria-label={t("Move down")}>
            ↓
          </button>
          <button type="button" className={iconBtn} onClick={onDelete} title={t("Delete list")} aria-label={t("Delete list")}>
            ✕
          </button>
        </span>
      </header>

      {items.length ? (
        <div className="overflow-x-auto">
          <table className="stack-table w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[#faf8f2] text-[11px] uppercase tracking-wide text-[#8f8676]">
              <tr>
                {/* aria-label: also the cards' label on phones (StackTableLabels), instead of "Bought✓". */}
                <th className="w-10 px-3 py-2 font-medium" title={t("Bought")} aria-label={t("Bought")}>
                  ✓
                </th>
                <th className="px-3 py-2 font-medium">{t("Title")}</th>
                <th className="px-3 py-2 font-medium">{t("Category")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Planned price")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("Paid")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {items.map((p) => (
                <tr key={p.id} className={p.bought ? "" : "bg-white"}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={p.bought}
                      onChange={(e) => onEditList((l) => ({ ...l, items: l.items.map((i) => (i.id === p.id ? { ...i, bought: e.target.checked } : i)) }))}
                      aria-label={t("Bought: {title}", { title: p.title })}
                      className="h-4 w-4 accent-emerald-600"
                    />
                  </td>
                  <td className="stack-title px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <button type="button" onClick={() => onOpen(p)} className="text-left font-medium text-[#1f1c17] hover:underline">
                        {p.title}
                      </button>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-xs text-[#8f8676] hover:text-[#1f1c17]" title={p.url} aria-label={t("Open the link")}>
                          ↗
                        </a>
                      ) : null}
                    </span>
                    {p.store || p.note ? <span className="block text-xs font-normal text-[#8f8676]">{[p.store, p.note].filter(Boolean).join(" · ")}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-[#6f675b]">{p.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#6f675b]">{money(p.planned, p.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#1f1c17]">
                    {p.bought && p.paid === 0 ? <span className="text-xs text-emerald-700">{t("gift / free")}</span> : money(p.paid, p.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-[#faf8f2] text-xs text-[#6f675b]">
              <tr>
                <td className="px-3 py-2" />
                <td className="stack-title px-3 py-2 font-medium" colSpan={2}>
                  {t("Sum")}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{sums(planned) || "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-[#1f1c17]">{sums(paid) || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : null}

      <form
        className="flex flex-wrap items-center gap-2 px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          const title = adding.trim();
          if (!title) return;
          onEditList((l) => ({ ...l, items: [...l.items, newPurchase(title.slice(0, 300), l.currency)] }));
          setAdding("");
        }}
      >
        <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder={t("Add to {list}…", { list: list.title })} className={`${field} min-w-0 flex-1 basis-48`} />
        <label className="inline-flex items-center gap-1.5 text-xs text-[#8f8676]" title={t("Currency for new items in this list")}>
          {t("New items in")}
          <select value={list.currency} onChange={(e) => onEditList((l) => ({ ...l, currency: e.target.value as Currency }))} className="h-7 rounded-full border border-black/10 bg-white px-2 text-xs text-[#3b352d]">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </form>
    </section>
  );
}

function ItemDialog({
  editing,
  lists,
  onClose,
  onSave,
  onDelete,
}: {
  editing: { item: Purchase; listId: string; isNew: boolean };
  lists: PurchaseList[];
  onClose: () => void;
  onSave: (item: Purchase, listId: string) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [item, setItem] = useState(editing.item);
  const [listId, setListId] = useState(editing.listId);
  const [planned, setPlanned] = useState(editing.item.planned == null ? "" : String(editing.item.planned));
  const [paid, setPaid] = useState(editing.item.paid == null ? "" : String(editing.item.paid));
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (patch: Partial<Purchase>) => setItem((i) => ({ ...i, ...patch }));
  const p = parseMoney(planned);
  const d = parseMoney(paid);
  const badLink = !!item.url.trim() && !isWebLink(item.url);
  const invalid = !item.title.trim() || badLink || p === "bad" || d === "bad";
  const label = (text: string, input: React.ReactNode) => (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-[#6f675b]">{text}</span>
      {input}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={t("Edit purchase")}
        onSubmit={(e) => {
          e.preventDefault();
          if (invalid) return;
          onSave(
            { ...item, title: item.title.trim(), category: item.category.trim(), store: item.store.trim(), url: item.url.trim(), note: item.note.trim(), planned: p as number | null, paid: d as number | null },
            listId,
          );
        }}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-[#1f1c17]">{t("Edit purchase")}</h2>
        {label(t("Title"), <input ref={first} required maxLength={300} value={item.title} onChange={(e) => set({ title: e.target.value })} className={`${field} w-full`} />)}
        <div className="grid grid-cols-2 gap-2">
          {label(t("Category"), <input maxLength={100} value={item.category} onChange={(e) => set({ category: e.target.value })} placeholder="Logitech" className={`${field} w-full`} />)}
          {label(t("Store"), <input maxLength={100} value={item.store} onChange={(e) => set({ store: e.target.value })} placeholder="Rozetka" className={`${field} w-full`} />)}
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          {label(
            t("Planned price"),
            <input inputMode="decimal" value={planned} onChange={(e) => setPlanned(e.target.value)} aria-invalid={p === "bad"} className={`${field} w-full ${p === "bad" ? "border-rose-400" : ""}`} />,
          )}
          {label(
            t("Paid"),
            <input inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder={t("0 = gift")} aria-invalid={d === "bad"} className={`${field} w-full ${d === "bad" ? "border-rose-400" : ""}`} />,
          )}
          {label(
            t("Currency"),
            <select value={item.currency} onChange={(e) => set({ currency: e.target.value as Currency })} className={`${field} w-full`}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>,
          )}
        </div>
        {p === "bad" || d === "bad" ? <p className="text-xs text-rose-700">{t("A price is a number of 0 or more, like 1299 or 10.81.")}</p> : null}
        {label(t("Link"), <input value={item.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://…" aria-invalid={badLink} className={`${field} w-full ${badLink ? "border-rose-400" : ""}`} />)}
        {badLink ? <p className="text-xs text-rose-700">{t("A link must start with http:// or https://")}</p> : null}
        {label(t("Note"), <textarea maxLength={2000} rows={2} value={item.note} onChange={(e) => set({ note: e.target.value })} className={`${field} w-full`} />)}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[#3b352d]">
            <input type="checkbox" checked={item.bought} onChange={(e) => set({ bought: e.target.checked })} className="h-4 w-4 accent-emerald-600" />
            {t("Bought")}
          </label>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-[#6f675b]">
            {t("List")}
            <select value={listId} onChange={(e) => setListId(e.target.value)} className={field}>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onDelete} className="rounded-full px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">
            {t("Delete")}
          </button>
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1.5 text-sm text-[#6f675b] hover:bg-[#f3efe5]">
            {t("Cancel")}
          </button>
          <button type="submit" disabled={invalid} className="rounded-full bg-[#1f1c17] px-4 py-1.5 text-sm font-medium text-[#f8f4eb] disabled:opacity-40">
            {t("Save")}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Paste or pick the Notion export (or this page's own); pick each list's currency, since Notion didn't keep it. */
function ImportDialog({ hasData, onImport, onClose }: { hasData: boolean; onImport: (lists: PurchaseList[], replace: boolean) => void; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [currencies, setCurrencies] = useState<Record<string, Currency>>({});
  const [replace, setReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return readLists(JSON.parse(text)) ?? "bad";
    } catch {
      return "bad" as const;
    }
  }, [text]);
  const currencyOf = (id: string) => currencies[id] ?? guessCurrency(id);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t("Import JSON")} className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-[#1f1c17]">{t("Import JSON")}</h2>
        <p className="text-sm text-[#6f675b]">{t("Paste the export or pick the file. The Notion page didn't record currencies: choose one for each list, then fix single items later.")}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className={btn}>
            {t("Choose file")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) f.text().then(setText);
              e.target.value = "";
            }}
          />
        </div>
        <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"lists": [...]}' className={`${field} w-full font-mono text-xs`} aria-label={t("JSON")} />
        {parsed === "bad" ? <p className="text-xs text-rose-700">{t("This isn't a purchases export: it needs a \"lists\" array with \"items\".")}</p> : null}
        {parsed && parsed !== "bad" ? (
          <ul className="divide-y divide-black/5 rounded-xl border border-black/5">
            {parsed.map((l) => (
              <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium text-[#1f1c17]">{l.title}</span>
                <span className="text-xs tabular-nums text-[#8f8676]">{t("{n} items", { n: l.count })}</span>
                <select
                  value={currencyOf(l.id)}
                  onChange={(e) => setCurrencies((c) => ({ ...c, [l.id]: e.target.value as Currency }))}
                  aria-label={t("Currency of {list}", { list: l.title })}
                  className="h-7 rounded-full border border-black/10 bg-white px-2 text-xs text-[#3b352d]"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        ) : null}
        {hasData ? (
          <label className="flex items-center gap-2 text-sm text-[#3b352d]">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            {t("Replace my lists (otherwise added after them)")}
          </label>
        ) : null}
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1.5 text-sm text-[#6f675b] hover:bg-[#f3efe5]">
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!parsed || parsed === "bad"}
            onClick={() => parsed && parsed !== "bad" && onImport(importLists(parsed, currencyOf), replace || !hasData)}
            className="rounded-full bg-[#1f1c17] px-4 py-1.5 text-sm font-medium text-[#f8f4eb] disabled:opacity-40"
          >
            {t("Import")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** `?q=` (from global search) pre-fills the search box. */
function PurchasesRoute() {
  const q = useSearchParams().get("q") ?? "";
  return (
    <RequireAuth>
      <PurchasesPage key={q} initialQuery={q} />
    </RequireAuth>
  );
}

export default function PurchasesRoutePage() {
  return (
    <Suspense>
      <PurchasesRoute />
    </Suspense>
  );
}
