"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import {
  SORTS,
  STATUSES,
  emptyItem,
  hostOf,
  nextStatus,
  parseImport,
  statusMeta,
  type Group,
  type Improvements,
  type Item,
  type Section,
  type Sort,
  type StatusFilter,
} from "@/features/life/improvements/types";
import { isWebLink, newId, norm } from "@/features/life/places/types";
import { apiFetch } from "@/lib/api";
import { filterSearch, filterSelect } from "@/lib/filter-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const field = "min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-black/25";
const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const chip = (on: boolean) =>
  `inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${on ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`;
const smallBtn = "rounded px-1.5 py-0.5 text-xs text-[#8f8676] hover:bg-[#f3efe5] hover:text-[#1f1c17]";

type Edit = (change: (d: Improvements) => Improvements) => void;
type Row = { item: Item; group: Group; section: Section };
type Editing = { item: Item; sectionId: string; groupId: string; isNew: boolean };

const COLLAPSED_KEY = "olivia.improvements.collapsed.v1";
const RECENT_DAYS = 30;

function readCollapsed(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: string[]) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // Not remembered; folding still works.
  }
}

/** Done, in progress and not started as one bar. */
function StackedBar({ done, progress, total, className = "h-2" }: { done: number; progress: number; total: number; className?: string }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <span className={`flex overflow-hidden rounded-full bg-[#efe9dc] ${className}`} aria-hidden>
      <span className="h-full bg-emerald-500 transition-all" style={{ width: `${pct(done)}%` }} />
      <span className="h-full bg-amber-400 transition-all" style={{ width: `${pct(progress)}%` }} />
    </span>
  );
}

const countOf = (items: Item[]) => ({
  total: items.length,
  done: items.filter((i) => i.status === "done").length,
  progress: items.filter((i) => i.status === "in_progress").length,
});
const itemsOf = (s: Section) => s.groups.flatMap((g) => g.items);

function ItemCard({ row, showGroup, highlighted, onStatus, onFocus, onEdit }: { row: Row; showGroup: boolean; highlighted: boolean; onStatus: () => void; onFocus: () => void; onEdit: () => void }) {
  const t = useT();
  const { item } = row;
  const meta = statusMeta(item.status);
  return (
    <article
      id={`item-${item.id}`}
      className={`flex min-w-0 flex-col gap-2 rounded-2xl border-2 bg-white p-3.5 shadow-[0_6px_20px_rgba(18,16,13,0.05)] transition ${highlighted ? "border-sky-400 ring-4 ring-sky-200" : meta.border} ${item.status === "done" ? "bg-emerald-50/40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <h4 className={`min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] leading-snug text-[#1f1c17] ${item.status === "done" ? "text-[#3f5e4d]" : ""}`}>{item.name}</h4>
        <button
          type="button"
          onClick={onFocus}
          aria-pressed={item.focus}
          aria-label={item.focus ? t("Remove from focus: {name}", { name: item.name }) : t("Focus on: {name}", { name: item.name })}
          title={item.focus ? t("In focus") : t("Focus on it")}
          className={`shrink-0 text-base leading-none transition ${item.focus ? "text-amber-500" : "text-[#cfc6b6] hover:text-amber-400"}`}
        >
          {item.focus ? "★" : "☆"}
        </button>
      </div>
      {item.details ? <p className="text-xs leading-relaxed text-[#6f675b] [overflow-wrap:anywhere] first-letter:uppercase">{item.details}</p> : null}
      {item.note ? <p className="rounded-lg bg-[#faf8f2] px-2 py-1 text-xs text-[#5f574b] [overflow-wrap:anywhere]">📝 {item.note}</p> : null}
      {item.links.length ? (
        <div className="flex flex-wrap gap-1">
          {item.links.map((l) => (
            <a key={l} href={l} target="_blank" rel="noreferrer" className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] text-[#3b352d] hover:bg-[#faf8f2]">
              {hostOf(l)} ↗
            </a>
          ))}
        </div>
      ) : null}
      <div className="mt-auto flex items-center gap-1.5 pt-1">
        <button
          type="button"
          onClick={onStatus}
          title={t("Tap to move on: not started → in progress → done")}
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold transition ${meta.pill}`}
        >
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />
          {t(meta.label)}
        </button>
        {showGroup ? (
          <span className="ml-auto min-w-0 truncate text-[11px] text-[#b0a79a]">
            {row.group.emoji} {row.group.title}
          </span>
        ) : null}
        <button type="button" onClick={onEdit} className={`${smallBtn} shrink-0 whitespace-nowrap ${showGroup ? "" : "ml-auto"}`}>
          {t("Edit")}
        </button>
      </div>
    </article>
  );
}

function Editor({ editing, sections, onSave, onDelete, onClose }: { editing: Editing; sections: Section[]; onSave: (e: Editing) => void; onDelete: () => void; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState(editing);
  const [links, setLinks] = useState(editing.item.links.join("\n"));
  const first = useRef<HTMLInputElement>(null);
  const set = (change: Partial<Item>) => setDraft((d) => ({ ...d, item: { ...d.item, ...change } }));
  const linkList = links.split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const badLink = linkList.some((l) => !isWebLink(l));
  const groups = sections.find((s) => s.id === draft.sectionId)?.groups ?? [];

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        aria-label={editing.isNew ? t("Add an item") : t("Edit item")}
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.item.name.trim() || badLink || !draft.groupId) return;
          onSave({ ...draft, item: { ...draft.item, name: draft.item.name.trim(), details: draft.item.details.trim(), links: linkList } });
        }}
        className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
      >
        <h2 className="text-lg font-semibold text-[#1f1c17]">{editing.isNew ? t("Add an item") : t("Edit item")}</h2>
        {label(t("Name"), <input ref={first} required maxLength={300} value={draft.item.name} onChange={(e) => set({ name: e.target.value })} className={`${field} w-full`} />)}
        {label(t("Details"), <textarea maxLength={2000} rows={2} value={draft.item.details} onChange={(e) => set({ details: e.target.value })} className={`${field} w-full`} />)}
        <div className="grid grid-cols-2 gap-2">
          {label(
            t("Area"),
            <select
              value={draft.sectionId}
              onChange={(e) => setDraft((d) => ({ ...d, sectionId: e.target.value, groupId: sections.find((s) => s.id === e.target.value)?.groups[0]?.id ?? "" }))}
              className={`${field} w-full`}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>,
          )}
          {label(
            t("Group"),
            <select value={draft.groupId} onChange={(e) => setDraft((d) => ({ ...d, groupId: e.target.value }))} className={`${field} w-full`}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.emoji} {g.title}
                </option>
              ))}
            </select>,
          )}
        </div>
        <div className="space-y-1">
          <span className="text-xs font-medium text-[#6f675b]">{t("Status")}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Status")}>
            {STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={draft.item.status === s.value}
                onClick={() => set({ status: s.value })}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${draft.item.status === s.value ? `${s.pill} ring-2 ring-black/20` : "bg-white text-[#6f675b] ring-1 ring-black/10"}`}
              >
                <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                {t(s.label)}
              </button>
            ))}
          </div>
        </div>
        {label(
          t("Links (one per line)"),
          <textarea rows={2} value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://…" aria-invalid={badLink} className={`${field} w-full ${badLink ? "border-rose-400" : ""}`} />,
        )}
        {badLink ? <p className="text-xs text-rose-700">{t("A link must start with http:// or https://")}</p> : null}
        {label(t("Note"), <textarea maxLength={4000} rows={2} value={draft.item.note} onChange={(e) => set({ note: e.target.value })} placeholder={t("What works, what doesn't, the next step…")} className={`${field} w-full`} />)}
        <label className="flex items-center gap-2 text-sm text-[#3b352d]">
          <input type="checkbox" checked={draft.item.focus} onChange={(e) => set({ focus: e.target.checked })} />
          {t("In focus")}
        </label>
        <div className="flex items-center gap-2 pt-1">
          {editing.isNew ? null : (
            <button type="button" onClick={onDelete} className="rounded-full px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">
              {t("Delete")}
            </button>
          )}
          <button type="button" onClick={onClose} className="ml-auto rounded-full px-3 py-1.5 text-sm text-[#6f675b] hover:bg-[#f3efe5]">
            {t("Cancel")}
          </button>
          <button type="submit" disabled={!draft.item.name.trim() || badLink || !draft.groupId} className="rounded-full bg-[#1f1c17] px-4 py-1.5 text-sm font-medium text-[#f8f4eb] disabled:opacity-40">
            {t("Save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog({ hasData, onImport, onClose }: { hasData: boolean; onImport: (d: Improvements) => void; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try {
      return parseImport(text);
    } catch {
      return null;
    }
  }, [text]);
  const count = parsed ? parsed.sections.reduce((a, s) => a + itemsOf(s).length, 0) : 0;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={t("Import from JSON")} className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="text-lg font-semibold text-[#1f1c17]">{t("Import from JSON")}</h2>
        <p className="text-xs text-[#6f675b]">{t("Sections → groups (emoji, title) → items (name, details, status: todo / in_progress / done, links).")}</p>
        <textarea autoFocus rows={10} value={text} onChange={(e) => (setText(e.target.value), setError(null))} placeholder='{ "sections": [ … ] }' aria-label={t("Import from JSON")} className={`${field} w-full font-mono text-xs`} />
        {error ? <p className="text-xs text-rose-700">{t(error)}</p> : parsed ? <p className="text-xs text-emerald-800">{t("Ready: {s} areas, {n} items.", { s: parsed.sections.length, n: count })}</p> : null}
        {hasData ? <p className="text-xs text-amber-800">⚠ {t("This replaces the current list.")}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm text-[#6f675b] hover:bg-[#f3efe5]">
            {t("Cancel")}
          </button>
          <button
            type="button"
            disabled={!text.trim()}
            onClick={() => {
              try {
                onImport(parseImport(text));
              } catch (e) {
                setError(e instanceof Error ? e.message : "This isn't valid JSON.");
              }
            }}
            className="rounded-full bg-[#1f1c17] px-4 py-1.5 text-sm font-medium text-[#f8f4eb] disabled:opacity-40"
          >
            {t("Import")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "🍎 Харчування" -> its emoji and title. */
function splitEmoji(text: string): { emoji: string; title: string } {
  const m = text.trim().match(/^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u);
  return m ? { emoji: m[1], title: m[2] || text.trim() } : { emoji: "", title: text.trim() };
}

/** A title in place: Enter saves, Esc or leaving the field cancels. An empty area or group can be deleted here. */
function RenameField({ value, label, onSave, onCancel, onDelete }: { value: string; label: string; onSave: (v: string) => void; onCancel: () => void; onDelete?: () => void }) {
  const t = useT();
  const [text, setText] = useState(value);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onSave(text.trim());
      }}
      className="flex min-w-0 flex-1 items-center gap-1.5"
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        maxLength={170}
        aria-label={label}
        className={`${field} min-w-0 flex-1 py-1`}
      />
      <button type="submit" disabled={!text.trim()} className="rounded-full bg-[#1f1c17] px-3 py-1 text-xs font-medium text-[#f8f4eb] disabled:opacity-40">
        {t("Save")}
      </button>
      <button type="button" onClick={onCancel} className={smallBtn}>
        {t("Cancel")}
      </button>
      {onDelete ? (
        <button type="button" onClick={onDelete} className="rounded px-1.5 py-0.5 text-xs text-rose-700 hover:bg-rose-50">
          {t("Delete")}
        </button>
      ) : null}
    </form>
  );
}

/** A one-line form: a name, Enter adds it. */
function AddInline({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        onAdd(name.trim());
        setName("");
      }}
      className="flex gap-2"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder={placeholder} aria-label={placeholder} className="min-w-0 flex-1 rounded-full border border-dashed border-black/15 bg-white/70 px-3.5 py-1.5 text-xs outline-none focus:border-black/30" />
    </form>
  );
}

function ImprovementsPage() {
  const t = useT();
  const locale = useLocale();
  const { token } = useAuth();
  const [data, setData] = useState<Improvements>({ sections: [] });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [section, setSection] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("sections");
  const [editing, setEditing] = useState<Editing | null>(null);
  const [importing, setImporting] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  // The area or group whose title is being changed.
  const [renaming, setRenaming] = useState<string | null>(null);
  // Read lazily: this page renders only after login, in the browser.
  const [collapsed, setCollapsed] = useState<string[]>(() => (typeof window === "undefined" ? [] : readCollapsed()));
  const latest = useRef<Improvements>(data);

  const fold = (next: string[]) => {
    setCollapsed(next);
    writeCollapsed(next);
  };

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<Improvements>("/life/improvements", { token })
      .then((d) => {
        if (!alive) return;
        latest.current = { sections: d.sections };
        setData(latest.current);
      })
      .catch(() => alive && setError("Could not load your list. Is the backend running?"))
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [token]);

  /** Applies a change right away and saves it; puts the list back if saving fails. */
  const edit: Edit = (change) => {
    const prev = latest.current;
    const next = change(prev);
    latest.current = next;
    setData(next);
    apiFetch("/life/improvements", { token: token ?? undefined, method: "PUT", body: JSON.stringify(next) })
      .then(() => setError(null))
      .catch(() => {
        if (latest.current === next) {
          latest.current = prev;
          setData(prev);
        }
        setError("Could not save — the change was undone.");
      });
  };

  const mapItem = (id: string, change: (i: Item) => Item) =>
    edit((d) => ({ sections: d.sections.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.id === id ? change(i) : i)) })) })) }));

  const rows: Row[] = useMemo(() => data.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((item) => ({ item, group: g, section: s })))), [data]);
  const all = countOf(rows.map((r) => r.item));
  const percent = all.total ? Math.round((all.done / all.total) * 100) : 0;
  const focus = rows.filter((r) => r.item.focus);
  const [nowMs] = useState(() => Date.now());
  const recent = rows
    .filter((r) => r.item.status === "done" && r.item.changed_at && nowMs - Date.parse(r.item.changed_at) < RECENT_DAYS * 86400000)
    .sort((a, b) => Date.parse(b.item.changed_at) - Date.parse(a.item.changed_at));
  // The area furthest behind, counting in progress as half done.
  const weakest = useMemo(() => {
    const scored = data.sections
      .map((s) => {
        const c = countOf(itemsOf(s));
        return { section: s, score: c.total ? (c.done + c.progress / 2) / c.total : 1, c };
      })
      .filter((x) => x.c.total >= 2);
    return scored.sort((a, b) => a.score - b.score)[0] ?? null;
  }, [data]);

  const shown = useMemo(() => {
    const q = norm(query.trim());
    const kept = rows.filter(
      ({ item, group, section: s }) =>
        (status === "all" || item.status === status) &&
        (section === "all" || s.id === section) &&
        (!q || norm(`${item.name} ${item.details} ${item.note} ${group.title} ${s.title}`).includes(q)),
    );
    if (sort === "name") return [...kept].sort((a, b) => a.item.name.localeCompare(b.item.name, locale));
    if (sort !== "sections") return [...kept].sort((a, b) => Number(b.item.status === sort) - Number(a.item.status === sort));
    return kept;
  }, [rows, status, section, query, sort, locale]);
  const filtering = status !== "all" || section !== "all" || query.trim() !== "";

  function cycle(id: string) {
    mapItem(id, (i) => ({ ...i, status: nextStatus(i.status), changed_at: new Date().toISOString() }));
  }

  function save(e: Editing) {
    const before = rows.find((r) => r.item.id === e.item.id)?.item;
    const item = { ...e.item, changed_at: before && before.status === e.item.status ? e.item.changed_at : new Date().toISOString() };
    edit((d) => {
      const without = d.sections.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== item.id) })) }));
      return {
        sections: without.map((s) => ({
          ...s,
          groups: s.groups.map((g) => {
            if (g.id !== e.groupId) return g;
            // An edited item keeps its place in its group; a new or moved one goes last.
            const old = d.sections.flatMap((x) => x.groups).find((x) => x.id === g.id)?.items.findIndex((i) => i.id === item.id) ?? -1;
            const items = [...g.items];
            items.splice(old >= 0 ? old : items.length, 0, item);
            return { ...g, items };
          }),
        })),
      };
    });
    setEditing(null);
  }

  function remove(id: string) {
    edit((d) => ({ sections: d.sections.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== id) })) })) }));
    setEditing(null);
  }

  const addSection = (title: string) => edit((d) => ({ sections: [...d.sections, { id: newId(), title, groups: [] }] }));
  const addGroup = (sectionId: string, title: string) => {
    const group: Group = { id: newId(), ...splitEmoji(title), items: [] };
    edit((d) => ({ sections: d.sections.map((s) => (s.id === sectionId ? { ...s, groups: [...s.groups, group] } : s)) }));
  };
  const renameSection = (id: string, title: string) => {
    edit((d) => ({ sections: d.sections.map((s) => (s.id === id ? { ...s, title } : s)) }));
    setRenaming(null);
  };
  const renameGroup = (id: string, text: string) => {
    edit((d) => ({ sections: d.sections.map((s) => ({ ...s, groups: s.groups.map((g) => (g.id === id ? { ...g, ...splitEmoji(text) } : g)) })) }));
    setRenaming(null);
  };
  const deleteSection = (id: string) => {
    edit((d) => ({ sections: d.sections.filter((s) => s.id !== id) }));
    setRenaming(null);
  };
  const deleteGroup = (id: string) => {
    edit((d) => ({ sections: d.sections.map((s) => ({ ...s, groups: s.groups.filter((g) => g.id !== id) })) }));
    setRenaming(null);
  };
  const newItem = (sectionId: string, groupId: string) => setEditing({ item: emptyItem(), sectionId, groupId, isNew: true });

  /** Something to take on next: a not-started item among those shown, brought into view. */
  function whatNext() {
    const pool = shown.filter((r) => r.item.status === "todo");
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (collapsed.includes(pick.section.id)) fold(collapsed.filter((id) => id !== pick.section.id));
    setHighlight(pick.item.id);
    requestAnimationFrame(() => document.getElementById(`item-${pick.item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const itemCard = (r: Row) => (
    <ItemCard
      key={r.item.id}
      row={r}
      showGroup={sort !== "sections"}
      highlighted={highlight === r.item.id}
      onStatus={() => cycle(r.item.id)}
      onFocus={() => mapItem(r.item.id, (i) => ({ ...i, focus: !i.focus }))}
      onEdit={() => setEditing({ item: r.item, sectionId: r.section.id, groupId: r.group.id, isNew: false })}
    />
  );
  const grid = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        {/* basis-64: on a phone the buttons move below instead of squeezing the title into a narrow column. */}
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Improvements")}</h1>
          <p className="mt-1 text-sm text-[#6f675b]">{t("Habits and goals across every area of life: what's done, what's in progress, what's next.")}</p>
        </div>
        {loaded ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setImporting(true)} className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm font-medium text-[#3b352d] hover:bg-[#faf8f2]">
              {t("Import JSON")}
            </button>
            {rows.length ? (
              <button type="button" onClick={whatNext} className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm font-medium text-[#3b352d] hover:bg-[#faf8f2]">
                🎯 {t("What to take on next?")}
              </button>
            ) : null}
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
      ) : !data.sections.length ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-black/10 bg-white/70 px-6 py-10 text-center">
          <p className="text-sm text-[#6f675b]">{t("Start with an area of life, such as Health or Home — or import your list from JSON.")}</p>
          <div className="mx-auto max-w-sm">
            <AddInline placeholder={t("New area, e.g. Health")} onAdd={addSection} />
          </div>
        </div>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className={card}>
              <p className="text-xs font-medium text-[#8f8676]">{t("Achieved")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">
                {all.done} <span className="text-base font-normal text-[#8f8676]">/ {all.total}</span>
                <span className="ml-2 text-sm font-medium text-emerald-700">{percent}%</span>
              </p>
              <div className="mt-2" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t("Achieved")}>
                <StackedBar done={all.done} progress={all.progress} total={all.total} />
              </div>
              <p className="mt-1.5 flex gap-3 text-[11px] text-[#8f8676]">
                <span>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                  {t("Underway")} {all.progress}
                </span>
                <span>
                  <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#cfc6b6]" aria-hidden />
                  {t("Not yet started")} {all.total - all.done - all.progress}
                </span>
              </p>
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-[#8f8676]">{t("Needs the most attention")}</p>
              {weakest ? (
                <>
                  <p className="mt-1 truncate text-lg font-semibold text-[#1f1c17]">{weakest.section.title}</p>
                  <p className="mt-1 text-xs text-[#8f8676]">{t("{done} of {n} done, {p} in progress", { done: weakest.c.done, n: weakest.c.total, p: weakest.c.progress })}</p>
                </>
              ) : (
                <p className="mt-1 text-sm text-[#8f8676]">—</p>
              )}
            </div>
            <div className={card}>
              <p className="text-xs font-medium text-[#8f8676]">{t("Done in the last 30 days")}</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[#1f1c17]">{recent.length}</p>
              <p className="mt-1 truncate text-xs text-[#8f8676]" title={recent.map((r) => r.item.name).join(", ")}>
                {recent.length ? recent.map((r) => r.item.name).join(", ") : t("Mark something done — it shows here.")}
              </p>
            </div>
          </section>

          <section aria-label={t("Focus now")} className="space-y-2">
            <h2 className="text-sm font-semibold text-[#1f1c17]">★ {t("Focus now")}</h2>
            {focus.length ? (
              <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
                {focus.map((r) => {
                  const meta = statusMeta(r.item.status);
                  return (
                    <div key={r.item.id} className={`w-60 shrink-0 snap-start space-y-1.5 rounded-xl border-2 bg-white p-3 ${meta.border}`}>
                      <p className="text-[11px] text-[#8f8676]">
                        {r.group.emoji} {r.section.title}
                      </p>
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-[#1f1c17]">{r.item.name}</p>
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => cycle(r.item.id)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
                          {t(meta.label)}
                        </button>
                        <button type="button" onClick={() => mapItem(r.item.id, (i) => ({ ...i, focus: false }))} className={`${smallBtn} ml-auto`} aria-label={t("Remove from focus: {name}", { name: r.item.name })}>
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-xs text-[#8f8676]">{t("Star ☆ two or three things you're working on now: they'll stay here, on top.")}</p>
            )}
          </section>

          <section className="space-y-2.5" aria-label={t("Filters")}>
            <div className="flex flex-wrap items-center gap-2">
              {/* Phones: the status pills scroll sideways on a row of their own; wider screens keep one row. */}
              <div className="scroll-row flex grow basis-full sm:contents">
              <span className="inline-flex h-8 items-center rounded-full border border-black/10 bg-white p-0.5" role="group" aria-label={t("Status")}>
                {([["all", t("All"), all.total, ""] as const, ...STATUSES.map((s) => [s.value, t(s.label), rows.filter((r) => r.item.status === s.value).length, s.dot] as const)]).map(([value, label, n, dot]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatus(value)}
                    aria-pressed={status === value}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status === value ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"}`}
                  >
                    {dot ? <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden /> : null}
                    {label} <span className="tabular-nums opacity-70">{n}</span>
                  </button>
                ))}
              </span>
              </div>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t("Sort")} className={filterSelect}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {t(s.label)}
                  </option>
                ))}
              </select>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Search habits and goals…")}
                aria-label={t("Search habits and goals…")}
                className={filterSearch}
              />
            </div>
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label={t("Area")}>
              <button type="button" onClick={() => setSection("all")} aria-pressed={section === "all"} className={chip(section === "all")}>
                {t("All")}
              </button>
              {data.sections.map((s) => {
                const c = countOf(itemsOf(s));
                return (
                  <button key={s.id} type="button" onClick={() => setSection(section === s.id ? "all" : s.id)} aria-pressed={section === s.id} className={chip(section === s.id)}>
                    {s.title}
                    <span className="tabular-nums opacity-70">
                      {c.done}/{c.total}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {sort !== "sections" ? (
            shown.length ? (
              <div className={grid}>{shown.map(itemCard)}</div>
            ) : (
              <p className="text-sm text-[#8f8676]">{t("Nothing matches these filters.")}</p>
            )
          ) : (
            <div className="space-y-6">
              {filtering && !shown.length ? <p className="text-sm text-[#8f8676]">{t("Nothing matches these filters.")}</p> : null}
              <div className="flex justify-end">
                <button type="button" onClick={() => fold(data.sections.every((s) => collapsed.includes(s.id)) ? [] : data.sections.map((s) => s.id))} className={smallBtn}>
                  {data.sections.every((s) => collapsed.includes(s.id)) ? t("Expand all") : t("Collapse all")}
                </button>
              </div>
              {data.sections.map((s) => {
                const visible = shown.filter((r) => r.section.id === s.id);
                if (filtering && !visible.length) return null;
                const c = countOf(itemsOf(s));
                const open = !collapsed.includes(s.id);
                return (
                  <section key={s.id} className="space-y-3">
                    {renaming === s.id ? (
                      <RenameField
                        value={s.title}
                        label={t("Area name")}
                        onSave={(v) => renameSection(s.id, v)}
                        onCancel={() => setRenaming(null)}
                        onDelete={s.groups.some((g) => g.items.length) ? undefined : () => deleteSection(s.id)}
                      />
                    ) : (
                      <h2 className="group/title flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => fold(open ? [...collapsed, s.id] : collapsed.filter((id) => id !== s.id))}
                          aria-expanded={open}
                          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left hover:bg-black/[0.02]"
                        >
                          <span className={`text-xs text-[#8f8676] transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
                            ▶
                          </span>
                          <span className="text-lg font-semibold text-[#1f1c17]">{s.title}</span>
                          <span className="shrink-0 text-xs tabular-nums text-[#8f8676]">
                            {c.done}/{c.total}
                          </span>
                          <StackedBar done={c.done} progress={c.progress} total={c.total} className="hidden h-1.5 max-w-40 flex-1 sm:flex" />
                        </button>
                        <button type="button" onClick={() => setRenaming(s.id)} aria-label={t("Rename: {name}", { name: s.title })} title={t("Rename")} className={`${smallBtn} shrink-0`}>
                          ✎
                        </button>
                      </h2>
                    )}
                    {open ? (
                      <div className="space-y-5 pl-0 sm:pl-5">
                        {s.groups.map((g) => {
                          const items = visible.filter((r) => r.group.id === g.id);
                          if (filtering && !items.length) return null;
                          return (
                            <div key={g.id} className="space-y-2">
                              {renaming === g.id ? (
                                <RenameField
                                  value={`${g.emoji ? `${g.emoji} ` : ""}${g.title}`}
                                  label={t("Group name (an emoji first, if you like)")}
                                  onSave={(v) => renameGroup(g.id, v)}
                                  onCancel={() => setRenaming(null)}
                                  onDelete={g.items.length ? undefined : () => deleteGroup(g.id)}
                                />
                              ) : (
                                <h3 className="flex items-center gap-2 text-sm font-semibold text-[#3b352d]">
                                  <span aria-hidden>{g.emoji}</span>
                                  {g.title}
                                  <span className="text-xs font-normal tabular-nums text-[#8f8676]">
                                    {g.items.filter((i) => i.status === "done").length}/{g.items.length}
                                  </span>
                                  <button type="button" onClick={() => setRenaming(g.id)} aria-label={t("Rename: {name}", { name: g.title })} title={t("Rename")} className={smallBtn}>
                                    ✎
                                  </button>
                                  {filtering ? null : (
                                    <button type="button" onClick={() => newItem(s.id, g.id)} className={`${smallBtn} ml-auto`}>
                                      + {t("Item")}
                                    </button>
                                  )}
                                </h3>
                              )}
                              {items.length ? <div className={grid}>{items.map(itemCard)}</div> : <p className="text-xs text-[#b0a79a]">{t("No items yet.")}</p>}
                            </div>
                          );
                        })}
                        {filtering ? null : (
                          <div className="max-w-xs">
                            <AddInline placeholder={t("New group, e.g. 🍎 Nutrition")} onAdd={(title) => addGroup(s.id, title)} />
                          </div>
                        )}
                      </div>
                    ) : null}
                  </section>
                );
              })}
              {filtering ? null : (
                <div className="max-w-xs">
                  <AddInline placeholder={t("New area of life")} onAdd={addSection} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {editing ? <Editor editing={editing} sections={data.sections} onSave={save} onDelete={() => remove(editing.item.id)} onClose={() => setEditing(null)} /> : null}
      {importing ? (
        <ImportDialog
          hasData={rows.length > 0}
          onImport={(d) => {
            edit(() => d);
            setImporting(false);
          }}
          onClose={() => setImporting(false)}
        />
      ) : null}
    </div>
  );
}

export default function Page() {
  return (
    <RequireAuth>
      <ImprovementsPage />
    </RequireAuth>
  );
}
