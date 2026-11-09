"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { CollapseScope, CollapseToggle } from "@/features/investing/dashboard/widgets";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import {
  CURRENCIES,
  STATUSES,
  isWebLink,
  mapPiece,
  move,
  newId,
  newPiece,
  norm,
  piecesOf,
  statusMeta,
  type Category,
  type Collection,
  type Currency,
  type Item,
  type Piece,
  type Status,
  type Wish,
} from "@/features/life/collection/types";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const card = "overflow-hidden rounded-2xl border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const field = "min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/25";
const iconBtn = "rounded px-1.5 py-0.5 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17] disabled:opacity-30";

type View = "collection" | "buy";
type Edit = (change: (c: Collection) => Collection) => void;

const parseCount = (v: string, min: number) => {
  const n = Number(v.trim());
  return v.trim() && Number.isInteger(n) && n >= min && n <= 1_000_000 ? n : null;
};

function useMoney() {
  const locale = useLocale();
  return (amount: number, currency: Currency) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
}

/** What is still to buy, summed per currency: "3 200 ₴ · 45 €". */
function useTotals() {
  const money = useMoney();
  return (wishes: Wish[]) => {
    const sums = new Map<Currency, number>();
    for (const w of wishes) if (!w.bought && w.price != null) sums.set(w.currency, (sums.get(w.currency) ?? 0) + w.price);
    return CURRENCIES.filter((c) => sums.has(c)).map((c) => money(sums.get(c)!, c)).join(" · ");
  };
}

function StatusSelect({ value, onChange, title }: { value: Status; onChange: (s: Status) => void; title: string }) {
  const t = useT();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Status)}
      aria-label={t("Status of “{title}”", { title })}
      className={`shrink-0 cursor-pointer appearance-none rounded-full px-2.5 py-0.5 text-center text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-black/20 ${statusMeta(value).pill}`}
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>
          {t(s.label)}
        </option>
      ))}
    </select>
  );
}

function Progress({ piece }: { piece: Piece }) {
  const t = useT();
  if (piece.count == null) return null;
  if (!piece.goal) return <span className="shrink-0 text-xs tabular-nums text-[#6f675b]">{t("{n} owned", { n: piece.count })}</span>;
  const share = Math.min(1, piece.count / piece.goal);
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-[#6f675b]" title={t("{n} of {goal}", { n: piece.count, goal: piece.goal })}>
      <span className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-[#efe9dc] sm:block" aria-hidden>
        <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${share * 100}%` }} />
      </span>
      {t("{n} of {goal}", { n: piece.count, goal: piece.goal })}
    </span>
  );
}

/** Things to buy for one line: tick when bought, add with an optional price and link. */
function WishList({ piece, onWishes }: { piece: Piece; onWishes: (next: Wish[]) => void }) {
  const t = useT();
  const money = useMoney();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState<Currency>(piece.wishes.at(-1)?.currency ?? "UAH");
  const [url, setUrl] = useState("");
  const badLink = url.trim() !== "" && !isWebLink(url);
  const amount = price.trim() ? Number(price.replace(",", ".")) : null;
  const badPrice = amount != null && (!Number.isFinite(amount) || amount < 0);

  function add() {
    if (!title.trim() || badLink || badPrice) return;
    onWishes([...piece.wishes, { id: newId(), title: title.trim(), url: url.trim(), price: amount, currency, bought: false }]);
    setTitle("");
    setPrice("");
    setUrl("");
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]">{t("To buy")}</p>
      {piece.wishes.length ? (
        <ul className="space-y-1">
          {piece.wishes.map((w) => (
            <li key={w.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={w.bought}
                onChange={() => onWishes(piece.wishes.map((x) => (x.id === w.id ? { ...x, bought: !x.bought } : x)))}
                aria-label={t("Bought “{title}”", { title: w.title })}
                className="h-4 w-4 shrink-0 accent-emerald-600"
              />
              <span className={`min-w-0 flex-1 truncate ${w.bought ? "text-[#a39a89] line-through" : "text-[#1f1c17]"}`}>
                {w.url ? (
                  <a href={w.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {w.title} <span aria-hidden className="text-[#2a78d6]">↗</span>
                  </a>
                ) : (
                  w.title
                )}
              </span>
              {w.price != null ? <span className="shrink-0 text-xs tabular-nums text-[#6f675b]">{money(w.price, w.currency)}</span> : null}
              <button type="button" onClick={() => onWishes(piece.wishes.filter((x) => x.id !== w.id))} aria-label={t("Delete “{title}”", { title: w.title })} className={iconBtn}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex flex-wrap gap-2"
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder={t("What to buy")} aria-label={t("What to buy")} className={`${field} flex-1 basis-40`} />
        <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={t("Price")} aria-label={t("Price")} aria-invalid={badPrice} className={`${field} w-24 tabular-nums ${badPrice ? "border-rose-300" : ""}`} />
        <select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} aria-label={t("Currency")} className={`${field} w-20`}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} placeholder={t("Link (optional)")} aria-label={t("Link")} aria-invalid={badLink} className={`${field} flex-1 basis-40 ${badLink ? "border-rose-300" : ""}`} />
        <button type="submit" disabled={!title.trim() || badLink || badPrice} className={`${investingToolbarBtn} disabled:opacity-40`}>
          {t("Add")}
        </button>
      </form>
    </div>
  );
}

/** The open line: its fields, sub-lines and what to buy. */
function PieceEditor({ piece, isItem, edit, onClose, first, last }: { piece: Piece; isItem: boolean; edit: Edit; onClose: () => void; first: boolean; last: boolean }) {
  const t = useT();
  const [title, setTitle] = useState(piece.title);
  const [note, setNote] = useState(piece.note);
  const [url, setUrl] = useState(piece.url);
  const [count, setCount] = useState(piece.count?.toString() ?? "");
  const [goal, setGoal] = useState(piece.goal?.toString() ?? "");
  const [child, setChild] = useState("");
  const badLink = url.trim() !== "" && !isWebLink(url);
  const update = (fn: (p: Piece) => Piece | null) => edit((c) => mapPiece(c, piece.id, fn));

  function save() {
    if (!title.trim() || badLink) return;
    update((p) => ({ ...p, title: title.trim(), note: note.trim(), url: url.trim(), count: parseCount(count, 0), goal: parseCount(goal, 1) }));
    onClose();
  }

  function addChild() {
    const name = child.trim();
    if (!name) return;
    setChild("");
    update((p) => ({ ...p, children: [...((p as Item).children ?? []), newPiece(name)] }) as Item);
  }

  return (
    <div className="space-y-4 border-t border-black/5 bg-[#fcfbf7] px-4 py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        className="grid gap-2 sm:grid-cols-2"
      >
        <label className="grid gap-1 text-xs text-[#6f675b] sm:col-span-2">
          {t("Name")}
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus className={field} />
        </label>
        <label className="grid gap-1 text-xs text-[#6f675b] sm:col-span-2">
          {t("Note")}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} rows={2} className={`${field} resize-y`} />
        </label>
        <label className="grid gap-1 text-xs text-[#6f675b] sm:col-span-2">
          {t("Link")}
          <input value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} placeholder="https://" aria-invalid={badLink} className={`${field} ${badLink ? "border-rose-300" : ""}`} />
          {badLink ? <span className="text-rose-700">{t("A link must start with http:// or https://")}</span> : null}
        </label>
        <label className="grid gap-1 text-xs text-[#6f675b]">
          {t("How many you have")}
          <input value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" className={`${field} tabular-nums`} />
        </label>
        <label className="grid gap-1 text-xs text-[#6f675b]">
          {t("Goal")}
          <input value={goal} onChange={(e) => setGoal(e.target.value.replace(/\D/g, "").slice(0, 7))} inputMode="numeric" placeholder={t("optional")} className={`${field} tabular-nums`} />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={!title.trim() || badLink} className={`${investingPrimarySaveActive} disabled:opacity-40`}>
            {t("Save")}
          </button>
          <button type="button" onClick={onClose} className={investingToolbarBtn}>
            {t("Cancel")}
          </button>
          <span className="ml-auto flex items-center gap-1">
            <button type="button" disabled={first} onClick={() => edit((c) => move(c, piece.id, -1))} aria-label={t("Move up")} title={t("Move up")} className={iconBtn}>
              ↑
            </button>
            <button type="button" disabled={last} onClick={() => edit((c) => move(c, piece.id, 1))} aria-label={t("Move down")} title={t("Move down")} className={iconBtn}>
              ↓
            </button>
            <button
              type="button"
              onClick={() => {
                const kids = (piece as Item).children?.length ?? 0;
                if (kids && !window.confirm(t("Delete “{title}” and its {n} sub-items?", { title: piece.title, n: kids }))) return;
                update(() => null);
              }}
              className="rounded px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50"
            >
              {t("Delete")}
            </button>
          </span>
        </div>
      </form>

      {isItem ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addChild();
          }}
          className="flex gap-2"
        >
          <input value={child} onChange={(e) => setChild(e.target.value)} maxLength={300} placeholder={t("Add a sub-item, e.g. an author or a series")} aria-label={t("Sub-item")} className={`${field} flex-1`} />
          <button type="submit" disabled={!child.trim()} className={`${investingToolbarBtn} disabled:opacity-40`}>
            {t("Add")}
          </button>
        </form>
      ) : null}

      <WishList piece={piece} onWishes={(wishes) => update((p) => ({ ...p, wishes }))} />
    </div>
  );
}

function PieceRow({
  piece,
  nested,
  isItem,
  open,
  onOpen,
  edit,
  first,
  last,
}: {
  piece: Piece;
  nested: boolean;
  isItem: boolean;
  open: boolean;
  onOpen: (id: string | null) => void;
  edit: Edit;
  first: boolean;
  last: boolean;
}) {
  const t = useT();
  const toBuy = piece.wishes.filter((w) => !w.bought).length;
  const parent = isItem && (piece as Item).children.length > 0;
  return (
    <div className={nested ? "ml-6 border-l border-black/10" : ""}>
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 ${open ? "bg-[#fcfbf7]" : "hover:bg-[#fcfbf7]"}`}>
        <StatusSelect value={piece.status} title={piece.title} onChange={(status) => edit((c) => mapPiece(c, piece.id, (p) => ({ ...p, status })))} />
        <button type="button" onClick={() => onOpen(open ? null : piece.id)} aria-expanded={open} className="min-w-0 flex-1 basis-40 text-left text-sm">
          <span className={`${parent ? "font-semibold" : ""} ${piece.status === "dropped" ? "text-[#8f8676] line-through decoration-rose-300" : "text-[#1f1c17]"}`}>{piece.title}</span>
          {piece.note ? <span className="text-[#8f8676]"> — {piece.note}</span> : null}
        </button>
        <Progress piece={piece} />
        {toBuy ? <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">{t("{n} to buy", { n: toBuy })}</span> : null}
        {piece.url ? (
          <a href={piece.url} target="_blank" rel="noreferrer" title={piece.url} aria-label={t("Open link for “{title}”", { title: piece.title })} className="shrink-0 rounded px-1 text-sm text-[#2a78d6] hover:bg-sky-50">
            ↗
          </a>
        ) : null}
      </div>
      {open ? <PieceEditor key={piece.id} piece={piece} isItem={isItem} edit={edit} onClose={() => onOpen(null)} first={first} last={last} /> : null}
    </div>
  );
}

function CategoryCard({
  category,
  items,
  filtering,
  openId,
  onOpen,
  edit,
  first,
  last,
}: {
  category: Category;
  items: { item: Item; children: Piece[] }[];
  filtering: boolean;
  openId: string | null;
  onOpen: (id: string | null) => void;
  edit: Edit;
  first: boolean;
  last: boolean;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [adding, setAdding] = useState("");
  const all = piecesOf(category);

  function rename() {
    setRenaming(false);
    const next = name.trim();
    if (next && next !== category.name) edit((c) => ({ categories: c.categories.map((x) => (x.id === category.id ? { ...x, name: next } : x)) }));
    else setName(category.name);
  }

  function addItem() {
    const title = adding.trim();
    if (!title) return;
    setAdding("");
    const item: Item = { ...newPiece(title), children: [] };
    edit((c) => ({ categories: c.categories.map((x) => (x.id === category.id ? { ...x, items: [...x.items, item] } : x)) }));
  }

  return (
    <CollapseScope id={`collection-${category.id}`}>
      {(open, toggle) => (
        <section className={card}>
          <div className={`flex flex-wrap items-center gap-2 bg-[#faf8f2] px-4 py-2.5 ${open ? "border-b border-black/5" : ""}`}>
            {renaming ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  rename();
                }}
                className="flex min-w-0 flex-1"
              >
                <input value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    setName(category.name);
                    setRenaming(false);
                  }} autoFocus maxLength={100} aria-label={t("Category name")} className={`${field} flex-1 font-semibold`} />
              </form>
            ) : (
              <h2 className="min-w-0 flex-1 text-base font-semibold text-[#1f1c17]">
                <CollapseToggle open={open} onToggle={toggle}>
                  {category.name}
                </CollapseToggle>
              </h2>
            )}
            <span className="flex items-center gap-2 text-xs tabular-nums text-[#6f675b]">
              {STATUSES.map((s) => {
                const n = all.filter((p) => p.status === s.value).length;
                return n ? (
                  <span key={s.value} className="inline-flex items-center gap-1" title={t(s.label)}>
                    <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                    <span className="sr-only">{t(s.label)}:</span>
                    {n}
                  </span>
                ) : null;
              })}
            </span>
            <span className="flex items-center">
              <button type="button" onClick={() => setRenaming(true)} aria-label={t("Rename “{title}”", { title: category.name })} title={t("Rename")} className={iconBtn}>
                ✎
              </button>
              <button type="button" disabled={first} onClick={() => edit((c) => move(c, category.id, -1))} aria-label={t("Move up")} title={t("Move up")} className={iconBtn}>
                ↑
              </button>
              <button type="button" disabled={last} onClick={() => edit((c) => move(c, category.id, 1))} aria-label={t("Move down")} title={t("Move down")} className={iconBtn}>
                ↓
              </button>
              <button
                type="button"
                onClick={() => {
                  if (all.length && !window.confirm(t("Delete “{title}” and its {n} items?", { title: category.name, n: all.length }))) return;
                  edit((c) => ({ categories: c.categories.filter((x) => x.id !== category.id) }));
                }}
                aria-label={t("Delete “{title}”", { title: category.name })}
                title={t("Delete")}
                className={`${iconBtn} hover:bg-rose-50 hover:text-rose-700`}
              >
                ✕
              </button>
            </span>
          </div>
          {open ? (
            <>
              {items.length ? (
                <ul className="divide-y divide-black/5">
                  {items.map(({ item, children }, i) => (
                    <li key={item.id}>
                      <PieceRow piece={item} nested={false} isItem open={openId === item.id} onOpen={onOpen} edit={edit} first={i === 0 || filtering} last={i === items.length - 1 || filtering} />
                      {children.map((child, j) => (
                        <PieceRow key={child.id} piece={child} nested isItem={false} open={openId === child.id} onOpen={onOpen} edit={edit} first={j === 0 || filtering} last={j === children.length - 1 || filtering} />
                      ))}
                    </li>
                  ))}
                </ul>
              ) : filtering ? null : (
                <p className="px-4 py-3 text-sm text-[#8f8676]">{t("Nothing here yet.")}</p>
              )}
              {filtering ? null : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addItem();
                  }}
                  className="flex gap-2 border-t border-black/5 px-4 py-2"
                >
                  <input value={adding} onChange={(e) => setAdding(e.target.value)} maxLength={300} placeholder={t("Add to {name}…", { name: category.name })} aria-label={t("Add to {name}…", { name: category.name })} className={`${field} flex-1 border-transparent bg-transparent px-0 focus:border-transparent`} />
                  {adding.trim() ? (
                    <button type="submit" className={investingToolbarBtn}>
                      {t("Add")}
                    </button>
                  ) : null}
                </form>
              )}
            </>
          ) : null}
        </section>
      )}
    </CollapseScope>
  );
}

/** Everything still to buy, across the collection, with what it's for. */
function BuyList({ collection, edit }: { collection: Collection; edit: Edit }) {
  const t = useT();
  const money = useMoney();
  const totals = useTotals();
  const [showBought, setShowBought] = useState(false);
  const groups = collection.categories
    .map((c) => ({
      category: c,
      rows: piecesOf(c).flatMap((p) => p.wishes.filter((w) => showBought || !w.bought).map((w) => ({ piece: p, wish: w }))),
    }))
    .filter((g) => g.rows.length);
  const everything = collection.categories.flatMap((c) => piecesOf(c).flatMap((p) => p.wishes));
  const left = everything.filter((w) => !w.bought);
  const setWish = (piece: Piece, wish: Wish, next: Wish | null) =>
    edit((c) => mapPiece(c, piece.id, (p) => ({ ...p, wishes: next ? p.wishes.map((w) => (w.id === wish.id ? next : w)) : p.wishes.filter((w) => w.id !== wish.id) })));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-[#3b352d]">
        <span>
          {t("{n} things to buy", { n: left.length })}
          {totals(left) ? <span className="font-semibold"> · {totals(left)}</span> : null}
        </span>
        {everything.length > left.length ? (
          <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-[#6f675b]">
            <input type="checkbox" checked={showBought} onChange={(e) => setShowBought(e.target.checked)} className="accent-[#1f1c17]" />
            {t("Show bought")}
          </label>
        ) : null}
      </div>
      {!groups.length ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center text-sm text-[#6f675b]">{t("Nothing to buy. Open a line in your collection and add what you want under “To buy”.")}</p>
      ) : (
        groups.map(({ category, rows }) => (
          <section key={category.id} className={card}>
            <h2 className="flex items-center gap-2 border-b border-black/5 bg-[#faf8f2] px-4 py-2.5 text-sm font-semibold text-[#1f1c17]">
              {category.name}
              <span className="ml-auto text-xs font-normal text-[#6f675b]">{totals(rows.map((r) => r.wish))}</span>
            </h2>
            <ul className="divide-y divide-black/5">
              {rows.map(({ piece, wish }) => (
                <li key={wish.id} className="flex items-center gap-3 px-4 py-2">
                  <input type="checkbox" checked={wish.bought} onChange={() => setWish(piece, wish, { ...wish, bought: !wish.bought })} aria-label={t("Bought “{title}”", { title: wish.title })} className="h-4 w-4 shrink-0 accent-emerald-600" />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${wish.bought ? "text-[#a39a89] line-through" : "text-[#1f1c17]"}`}>
                      {wish.url ? (
                        <a href={wish.url} target="_blank" rel="noreferrer" className="hover:underline">
                          {wish.title} <span aria-hidden className="text-[#2a78d6]">↗</span>
                        </a>
                      ) : (
                        wish.title
                      )}
                    </span>
                    <span className="block truncate text-[11px] text-[#8f8676]">{t("for {title}", { title: piece.title })}</span>
                  </span>
                  {wish.price != null ? <span className="shrink-0 text-sm tabular-nums text-[#3b352d]">{money(wish.price, wish.currency)}</span> : null}
                  <button type="button" onClick={() => setWish(piece, wish, null)} aria-label={t("Delete “{title}”", { title: wish.title })} className={iconBtn}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function CollectionPage({ initialQuery }: { initialQuery: string }) {
  const { token } = useAuth();
  const t = useT();
  const totals = useTotals();
  const [collection, setCollection] = useState<Collection>({ categories: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("collection");
  const [status, setStatus] = useState<Status | "all">("all");
  const [query, setQuery] = useState(initialQuery);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const latest = useRef<Collection>({ categories: [] });

  useEffect(() => {
    if (!token) return;
    apiFetch<Collection>("/life/collection", { token })
      .then((d) => {
        latest.current = { categories: d.categories };
        setCollection(latest.current);
      })
      .catch(() => setError("Could not load your collection. Is the backend running?"))
      .finally(() => setLoaded(true));
  }, [token]);

  /** Applies a change right away and saves it; puts the collection back if saving fails. */
  const edit: Edit = (change) => {
    const prev = latest.current;
    const next = change(prev);
    latest.current = next;
    setCollection(next);
    apiFetch("/life/collection", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) })
      .then(() => setError(null))
      .catch(() => {
        if (latest.current === next) {
          latest.current = prev;
          setCollection(prev);
        }
        setError("Could not save — the change was undone.");
      });
  };

  const all = useMemo(() => collection.categories.flatMap(piecesOf), [collection]);
  const wishesLeft = all.flatMap((p) => p.wishes).filter((w) => !w.bought);
  const filtering = status !== "all" || query.trim() !== "";

  const shown = useMemo(() => {
    const q = norm(query);
    const matches = (p: Piece) => (status === "all" || p.status === status) && (!q || norm(`${p.title} ${p.note} ${p.wishes.map((w) => w.title).join(" ")}`).includes(q));
    return collection.categories
      .map((c) => ({
        category: c,
        items: c.items
          .map((item) => ({ item, children: filtering ? item.children.filter(matches) : item.children }))
          .filter(({ item, children }) => !filtering || matches(item) || children.length),
      }))
      .filter((g) => !filtering || g.items.length);
  }, [collection, status, query, filtering]);

  function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setNewCategory("");
    edit((c) => ({ categories: [...c.categories, { id: newId(), name, items: [] }] }));
  }

  const tab = (v: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(v)}
      aria-pressed={view === v}
      className={`rounded-full px-3 py-1 text-xs font-medium ${view === v ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
    >
      {label}
    </button>
  );

  return (
    <RequireAuth>
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Collecting")}</h1>
          {loaded && all.length ? (
            <p className="mt-1 text-sm text-[#6f675b]">
              {t("{n} categories", { n: collection.categories.length })} · {t("{n} lines", { n: all.length })}
              {wishesLeft.length ? ` · ${t("{n} things to buy", { n: wishesLeft.length })}${totals(wishesLeft) ? `, ${totals(wishesLeft)}` : ""}` : ""}
            </p>
          ) : null}
        </div>

        {error ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert">{t(error)}</p> : null}

        {!loaded ? (
          <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>
        ) : (
          <>
            {collection.categories.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-black/10 bg-white p-0.5">
                  {tab("collection", t("Collection"))}
                  {tab("buy", wishesLeft.length ? `${t("To buy")} · ${wishesLeft.length}` : t("To buy"))}
                </span>
                {view === "collection" ? (
                  <>
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search the collection…")} aria-label={t("Search the collection…")} className="w-full rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs outline-none focus:border-black/25 sm:ml-auto sm:w-56" />
                    <div className="flex w-full flex-wrap gap-1.5" role="group" aria-label={t("Status")}>
                      {[{ value: "all" as const, label: "All", dot: "" }, ...STATUSES].map((s) => {
                        const n = s.value === "all" ? all.length : all.filter((p) => p.status === s.value).length;
                        return (
                          <button
                            key={s.value}
                            type="button"
                            onClick={() => setStatus(s.value)}
                            aria-pressed={status === s.value}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status === s.value ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`}
                          >
                            {s.dot ? <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden /> : null}
                            {t(s.label)}
                            <span className="tabular-nums opacity-70">{n}</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {view === "buy" ? (
              <BuyList collection={collection} edit={edit} />
            ) : (
              <div className="space-y-3">
                {!collection.categories.length ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center text-sm text-[#6f675b]">{t("Start with a category, such as Comics or LEGO.")}</p>
                ) : filtering && !shown.length ? (
                  <p className="text-sm text-[#8f8676]">{t("Nothing matches these filters.")}</p>
                ) : null}
                {shown.map(({ category, items }, i) => (
                  <CategoryCard
                    key={category.id}
                    category={category}
                    items={items}
                    filtering={filtering}
                    openId={openId}
                    onOpen={setOpenId}
                    edit={edit}
                    first={i === 0 || filtering}
                    last={i === shown.length - 1 || filtering}
                  />
                ))}
                {filtering ? null : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      addCategory();
                    }}
                    className="flex gap-2"
                  >
                    <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} maxLength={100} placeholder={t("New category")} aria-label={t("New category")} className="min-w-0 flex-1 rounded-full border border-black/10 bg-white px-4 py-2 text-sm outline-none focus:border-black/25" />
                    <button type="submit" disabled={!newCategory.trim()} className={`${investingPrimarySaveActive} disabled:opacity-40`}>
                      {t("Add category")}
                    </button>
                  </form>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </RequireAuth>
  );
}

/** `?q=` (from global search) pre-fills the search box. */
function CollectionRoute() {
  const q = useSearchParams().get("q") ?? "";
  return <CollectionPage key={q} initialQuery={q} />;
}

export default function CollectionRoutePage() {
  return (
    <Suspense>
      <CollectionRoute />
    </Suspense>
  );
}
