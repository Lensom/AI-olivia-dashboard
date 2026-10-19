"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Poster } from "@/features/cinema/ui";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useT, type T } from "@/lib/i18n";

/** A ranked list you curate (Cinematography and Library Tops share this shape). */
export type RankedListEntry = { id: string; title_id: string; text: string; note: string };
export type RankedList = { id: string; title: string; size: number; entries: RankedListEntry[] };

/** One title as the Tops board sees it, whatever section it comes from. */
export type TopItem = {
  id: string;
  title: string;
  altTitle: string;
  subtitle: string;
  cover: string;
  href: string;
  kind: string;
  /** Your grade, used for the group average; null = not graded (left out of the automatic tops). */
  score: number | null;
  /** Sort key, best first: compared element by element, higher wins. */
  rank: number[];
  /** Group names per dimension, e.g. { genre: ["Драма"], actor: [...] }. */
  groups: Record<string, string[]>;
  badges: ReactNode;
};

/** `format` turns a group key into its heading (e.g. "1990" → "1990s" / "1990-ті"); default shows the key as is. */
export type TopDimension = { value: string; label: string; min: number; newestFirst?: boolean; format?: (key: string, t: T) => string };

export const newEntryId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random()}`;

const compareRank = (a: TopItem, b: TopItem) => {
  for (let i = 0; i < Math.max(a.rank.length, b.rank.length); i++) {
    const d = (b.rank[i] ?? -Infinity) - (a.rank[i] ?? -Infinity);
    if (d) return d;
  }
  return a.title.localeCompare(b.title);
};

export const rankItems = (list: TopItem[]) => [...list].sort(compareRank);

export const entryFor = (t: TopItem): RankedListEntry => ({ id: newEntryId(), title_id: t.id, text: t.title, note: "" });

const norm = (s: string) => s.toLowerCase().replace(/ґ/g, "г").replace(/[^\p{L}\p{N}]+/gu, "");

/** Links free text to an item when exactly one has that name (or starts with it). */
export function matchItem(text: string, items: TopItem[]): TopItem | null {
  const q = norm(text);
  if (!q) return null;
  const exact = items.filter((t) => norm(t.title) === q || norm(t.altTitle) === q);
  if (exact.length) return rankItems(exact)[0];
  const prefix = items.filter((t) => norm(t.title).startsWith(q));
  return prefix.length === 1 ? prefix[0] : null;
}

export function listFromTexts(title: string, texts: string[], items: TopItem[], size = 5): RankedList {
  return {
    id: newEntryId(),
    title,
    size: Math.max(size, texts.length),
    entries: texts.map((text) => {
      const t = matchItem(text, items);
      return t ? entryFor(t) : { id: newEntryId(), title_id: "", text, note: "" };
    }),
  };
}

type AutoTop = { key: string; count: number; avg: number; top: TopItem[] };

function autoTops(items: TopItem[], dim: TopDimension, kind: string, n = 5): AutoTop[] {
  const groups = new Map<string, TopItem[]>();
  for (const t of items) {
    if (t.score == null || (kind !== "all" && t.kind !== kind)) continue;
    for (const k of new Set(t.groups[dim.value] ?? [])) groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length >= dim.min)
    .map(([key, list]) => ({
      key,
      count: list.length,
      avg: list.reduce((a, t) => a + (t.score ?? 0), 0) / list.length,
      top: rankItems(list).slice(0, n),
    }))
    .sort((a, b) => (dim.newestFirst ? b.key.localeCompare(a.key) : b.count - a.count || b.avg - a.avg));
}

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const smallBtn = "rounded-md px-1.5 text-xs text-[#6f675b] hover:bg-[#f3efe5] hover:text-[#1f1c17] disabled:opacity-30";

const errorText = (e: unknown, fallback: string) => {
  const msg = (e as { message?: string })?.message;
  try {
    return msg ? ((JSON.parse(msg) as { detail?: string }).detail ?? fallback) : fallback;
  } catch {
    return msg || fallback;
  }
};

function EntryRow({ n, entry, item }: { n: number; entry?: RankedListEntry; item?: TopItem }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="w-5 shrink-0 text-right text-sm tabular-nums text-[#8f8676]">{n}.</span>
      {!entry ? (
        <span className="text-sm text-[#c4bcae]">—</span>
      ) : item ? (
        <>
          <Poster src={item.cover} title={item.title} className="h-10 w-7 shrink-0" />
          <Link href={item.href} className="min-w-0 flex-1 hover:underline">
            <span className="block truncate text-sm font-medium text-[#1f1c17]">{item.title}</span>
            <span className="block truncate text-[11px] text-[#8f8676]">{entry.note || item.subtitle}</span>
          </Link>
          <span className="flex shrink-0 items-center gap-2">{item.badges}</span>
        </>
      ) : (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-[#1f1c17]">{entry.text}</span>
          {entry.note ? <span className="block truncate text-[11px] text-[#8f8676]">{entry.note}</span> : null}
        </span>
      )}
    </li>
  );
}

/** Search the library to add an item, or add whatever was typed as free text. */
function EntryPicker({ items, exclude, onAdd }: { items: TopItem[]; exclude: Set<string>; onAdd: (e: RankedListEntry) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return rankItems(items.filter((t) => !exclude.has(t.id) && (t.title.toLowerCase().includes(s) || t.altTitle.toLowerCase().includes(s)))).slice(0, 7);
  }, [q, items, exclude]);
  const add = (e: RankedListEntry) => {
    onAdd(e);
    setQ("");
  };
  const addText = () => q.trim() && add({ id: newEntryId(), title_id: "", text: q.trim(), note: "" });
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (matches[0]) add(entryFor(matches[0]));
            else addText();
          }
        }}
        placeholder={t("Add a title from your library, or any text…")}
        className="w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/25"
      />
      {q.trim().length >= 2 ? (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-black/10 bg-white p-1 shadow-lg">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => add(entryFor(m))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[#faf8f2]">
                <Poster src={m.cover} title={m.title} className="h-9 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[#1f1c17]">{m.title}</span>
                  <span className="block text-[11px] text-[#8f8676]">{m.subtitle}</span>
                </span>
                {m.badges}
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={addText} className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-[#6f675b] hover:bg-[#faf8f2]">
              {t("Add “{text}” as text", { text: q.trim() })} <span className="text-[#a39a89]">{t("— a series, a character…")}</span>
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

function ListCard({
  list,
  byId,
  items,
  onSave,
  onDelete,
}: {
  list: RankedList;
  byId: Map<string, TopItem>;
  items: TopItem[];
  onSave: (l: RankedList) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<RankedList | null>(list.title ? null : list); // a new, unnamed list opens in edit mode
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!draft) {
    const slots = Math.max(list.size, list.entries.length);
    return (
      <section className={`${card} group`}>
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-[#1f1c17]">{list.title}</h3>
          <button type="button" onClick={() => setDraft(list)} className="text-xs text-[#8f8676] opacity-0 transition hover:text-[#1f1c17] group-hover:opacity-100 focus:opacity-100">
            {t("Edit")}
          </button>
        </div>
        <ol>
          {Array.from({ length: slots }, (_, i) => {
            const e = list.entries[i];
            return <EntryRow key={e?.id ?? `empty-${i}`} n={i + 1} entry={e} item={e?.title_id ? byId.get(e.title_id) : undefined} />;
          })}
        </ol>
      </section>
    );
  }

  const setEntries = (entries: RankedListEntry[]) => setDraft((d) => d && { ...d, entries });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= draft.entries.length || from === to) return;
    const next = [...draft.entries];
    const [e] = next.splice(from, 1);
    next.splice(to, 0, e);
    setEntries(next);
  };

  async function done() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({ ...draft, title: draft.title.trim() || t("Untitled list") });
      setDraft(null);
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} ring-2 ring-[#2a78d6]/30`}>
      <input
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        placeholder={t("List name — e.g. Top thrillers")}
        className="w-full rounded-lg border border-black/10 px-2.5 py-1.5 text-lg font-semibold text-[#1f1c17] outline-none focus:border-black/25"
        autoFocus={!list.title}
      />
      <ol className="mt-3 space-y-1">
        {draft.entries.map((e, i) => {
          const item = e.title_id ? byId.get(e.title_id) : undefined;
          return (
            <li
              key={e.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(ev) => ev.preventDefault()}
              onDrop={() => {
                if (dragIdx != null) move(dragIdx, i);
                setDragIdx(null);
              }}
              className={`flex items-center gap-2 rounded-lg px-1 py-1 ${dragIdx === i ? "bg-[#f3efe5]" : "hover:bg-[#faf8f2]"}`}
            >
              <span aria-hidden className="cursor-grab select-none text-[#b5ad9f]" title={t("Drag to reorder")}>
                ⠿
              </span>
              <span className="w-5 shrink-0 text-right text-sm tabular-nums text-[#8f8676]">{i + 1}.</span>
              {item ? <Poster src={item.cover} title={item.title} className="h-9 w-6 shrink-0" /> : null}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-[#1f1c17]">{item?.title ?? e.text}</span>
                <input
                  value={e.note}
                  onChange={(ev) => setEntries(draft.entries.map((x) => (x.id === e.id ? { ...x, note: ev.target.value } : x)))}
                  placeholder={item ? t("Note — e.g. the character") : t("Note")}
                  className="w-full bg-transparent text-[11px] text-[#6f675b] outline-none placeholder:text-[#c4bcae]"
                />
              </span>
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className={smallBtn} aria-label={t("Move up")}>
                ↑
              </button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === draft.entries.length - 1} className={smallBtn} aria-label={t("Move down")}>
                ↓
              </button>
              <button type="button" onClick={() => setEntries(draft.entries.filter((x) => x.id !== e.id))} className={`${smallBtn} hover:text-rose-700`} aria-label={t("Remove")}>
                ✕
              </button>
            </li>
          );
        })}
      </ol>
      <div className="mt-2">
        <EntryPicker items={items} exclude={new Set(draft.entries.map((e) => e.title_id).filter(Boolean))} onAdd={(e) => setEntries([...draft.entries, e])} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#6f675b]">
        {t("Slots")}
        <button type="button" onClick={() => setDraft({ ...draft, size: Math.max(1, draft.size - 1) })} className={investingToolbarBtn} aria-label={t("Fewer slots")}>
          −
        </button>
        <span className="tabular-nums">{draft.size}</span>
        <button type="button" onClick={() => setDraft({ ...draft, size: Math.min(50, draft.size + 1) })} className={investingToolbarBtn} aria-label={t("More slots")}>
          +
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void done()} disabled={busy} className={investingPrimarySaveActive}>
          {busy ? t("Saving…") : t("Done")}
        </button>
        {list.title ? (
          <button type="button" onClick={() => setDraft(null)} className={investingToolbarBtn}>
            {t("Cancel")}
          </button>
        ) : null}
        {confirmDelete ? (
          <span className="ml-auto flex items-center gap-2 text-xs text-rose-800">
            {t("Delete this list?")}
            <button type="button" onClick={() => void onDelete()} className="rounded-full bg-rose-700 px-3 py-1 font-medium text-white">
              {t("Delete")}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="underline">
              {t("Keep")}
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto text-xs text-rose-700 underline decoration-rose-200 underline-offset-2">
            {t("Delete list")}
          </button>
        )}
      </div>
    </section>
  );
}

type Props = {
  items: TopItem[];
  lists: RankedList[];
  updateLists: (change: (lists: RankedList[]) => RankedList[]) => Promise<void>;
  dimensions: TopDimension[];
  kinds: { value: string; label: string }[];
  /** Shown while there are no lists, e.g. "Recreate my Notion tops". */
  starter?: { label: string; build: (items: TopItem[]) => RankedList[] };
  /** How ties are broken in the automatic tops, for the subtitle. */
  tieBreak: string;
};

/** "My tops" (curated lists) plus "Built from your ratings" (automatic tops per genre, author…). */
export function TopsBoard({ items, lists, updateLists, dimensions, kinds, starter, tieBreak }: Props) {
  const t = useT();
  const [dim, setDim] = useState(dimensions[0]);
  const [kind, setKind] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map((t) => [t.id, t])), [items]);
  const tops = useMemo(() => autoTops(items, dim, kind), [items, dim, kind]);
  const shown = showAll ? tops : tops.slice(0, 9);

  const save = (l: RankedList) => updateLists((all) => (all.some((x) => x.id === l.id) ? all.map((x) => (x.id === l.id ? l : x)) : [...all, l]));
  const addLists = (ls: RankedList[]) => updateLists((all) => [...all, ...ls]).catch((e) => setNotice(t(errorText(e, "Could not save."))));
  const heading = (key: string) => (dim.format ? dim.format(key, t) : key);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-[#1f1c17]">{t("My tops")}</h2>
            <p className="text-xs text-[#6f675b]">{t("Lists you rank yourself. Hover a list and press Edit to reorder, add or rename.")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!lists.length && starter ? (
              <button type="button" onClick={() => void addLists(starter.build(items))} className={investingToolbarBtn}>
                {t(starter.label)}
              </button>
            ) : null}
            <button type="button" onClick={() => void addLists([{ id: newEntryId(), title: "", size: 5, entries: [] }])} className={investingPrimarySaveActive}>
              + {t("New list")}
            </button>
          </div>
        </div>
        {notice ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{notice}</p> : null}
        {lists.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {lists.map((l) => (
              <ListCard key={l.id} list={l} byId={byId} items={items} onSave={save} onDelete={() => updateLists((all) => all.filter((x) => x.id !== l.id))} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-8 text-center text-sm text-[#6f675b]">
            {t("No lists yet. Start a new one, or copy one of the tops below.")}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-[#1f1c17]">{t("Built from your ratings")}</h2>
          <p className="text-xs text-[#6f675b]">{t("Your best-scored titles in each group ({tieBreak}). Updates by itself as you grade.", { tieBreak: t(tieBreak) })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dimensions.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => {
                setDim(d);
                setShowAll(false);
              }}
              aria-pressed={dim.value === d.value}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                dim.value === d.value ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"
              }`}
            >
              {t(d.label)}
            </button>
          ))}
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="ml-auto rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]" aria-label={t("Which titles")}>
            <option value="all">{t("All titles")}</option>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>
                {t(k.label)}
              </option>
            ))}
          </select>
        </div>
        {tops.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
            {shown.map((g) => (
              <section key={g.key} className={`${card} group`}>
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="truncate text-base font-semibold text-[#1f1c17]">{heading(g.key)}</h3>
                  <button
                    type="button"
                    onClick={() => void addLists([{ id: newEntryId(), title: t("Top: {v}", { v: heading(g.key) }), size: 5, entries: g.top.map(entryFor) }])}
                    className="shrink-0 text-xs text-[#8f8676] opacity-0 transition hover:text-[#1f1c17] group-hover:opacity-100 focus:opacity-100"
                  >
                    {t("Copy to my lists")}
                  </button>
                </div>
                <p className="text-[11px] text-[#8f8676]">
                  {t("{n} graded", { n: g.count })} · {t("avg {v}", { v: g.avg.toFixed(1) })}
                </p>
                <ol className="mt-1">
                  {g.top.map((item, i) => (
                    <EntryRow key={item.id} n={i + 1} entry={{ id: item.id, title_id: item.id, text: item.title, note: "" }} item={item} />
                  ))}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#8f8676]">{t("Not enough graded titles for this yet.")}</p>
        )}
        {tops.length > 9 ? (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="text-xs text-[#6f675b] underline decoration-black/15 underline-offset-2">
            {showAll ? t("Show fewer") : t("Show all {n}", { n: tops.length })}
          </button>
        ) : null}
      </section>
    </div>
  );
}
