"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { defaultIcon, emptyTable, type PageKind, type PageSummary } from "@/features/pages/types";
import { useT } from "@/lib/i18n";
import { usePages } from "@/state/pages-store";

const OPEN_KEY = "olivia.pages.open.v1";

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

type Drop = { id: string; where: "before" | "inside" | "after" } | null;

/** Notion-style page tree: expand/collapse, + for a subpage, ⋯ menu, drag to reorder or nest. */
export function PageTree() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const { childrenOf, byId, create, remove, move, isLoaded } = usePages();
  // Read lazily: the tree only renders after pages load, so this never affects the first paint.
  const [open, setOpen] = useState<Record<string, boolean>>(() => (typeof window === "undefined" ? {} : readOpen()));
  const [menu, setMenu] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop>(null);
  const activeId = pathname.startsWith("/pages/") ? pathname.slice("/pages/".length) : null;

  // Ancestors of the open page stay expanded.
  const ancestors = new Set<string>();
  for (let p = activeId ? byId.get(activeId) : undefined; p?.parent_id; p = byId.get(p.parent_id)) ancestors.add(p.parent_id);

  function toggle(id: string, value: boolean) {
    setOpen((prev) => {
      const next = { ...prev, [id]: value };
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Not remembered; toggling still works.
      }
      return next;
    });
  }

  async function add(parentId: string | null, kind: PageKind) {
    const page = await create({ parent_id: parentId, kind, content: kind === "table" ? emptyTable(t) : null });
    if (parentId) toggle(parentId, true);
    setMenu(null);
    router.push(`/pages/${page.id}`);
  }

  async function onDelete(p: PageSummary) {
    setMenu(null);
    const subs = childrenOf(p.id).length;
    const name = p.title || t("Untitled");
    if (!window.confirm(subs ? t("Delete “{title}” and its subpages?", { title: name }) : t("Delete “{title}”?", { title: name }))) return;
    await remove(p.id);
    if (activeId === p.id || (activeId && isInside(activeId, p.id))) router.push("/pages");
  }

  function isInside(id: string, ancestorId: string): boolean {
    for (let p = byId.get(id); p?.parent_id; p = byId.get(p.parent_id)) if (p.parent_id === ancestorId) return true;
    return false;
  }

  function onDrop() {
    if (!dragId || !drop || dragId === drop.id || isInside(drop.id, dragId)) return reset();
    const target = byId.get(drop.id);
    if (!target) return reset();
    if (drop.where === "inside") {
      void move(dragId, target.id, childrenOf(target.id).length);
      toggle(target.id, true);
    } else {
      const siblings = childrenOf(target.parent_id).filter((s) => s.id !== dragId);
      const at = siblings.findIndex((s) => s.id === target.id);
      void move(dragId, target.parent_id, drop.where === "before" ? at : at + 1);
    }
    reset();
  }

  function reset() {
    setDragId(null);
    setDrop(null);
  }

  function renderRow(p: PageSummary, depth: number) {
    const kids = childrenOf(p.id);
    const isOpen = open[p.id] ?? ancestors.has(p.id);
    const active = p.id === activeId;
    const marker = drop?.id === p.id ? drop.where : null;
    return (
      <li key={p.id}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", p.id);
            setDragId(p.id);
          }}
          onDragEnd={reset}
          onDragOver={(e) => {
            if (!dragId || dragId === p.id) return;
            e.preventDefault();
            const r = e.currentTarget.getBoundingClientRect();
            const y = (e.clientY - r.top) / r.height;
            const where = y < 0.25 ? "before" : y > 0.75 ? "after" : "inside";
            if (drop?.id !== p.id || drop.where !== where) setDrop({ id: p.id, where });
          }}
          onDrop={(e) => {
            e.preventDefault();
            onDrop();
          }}
          className={[
            "group relative flex items-center gap-1 rounded-lg py-1 pr-1 text-sm transition",
            active ? "bg-[#efe9dc] text-[#1f1c17]" : "text-[#4a443a] hover:bg-[#f4efe4]",
            marker === "inside" ? "ring-2 ring-[#2a78d6]/50" : "",
            dragId === p.id ? "opacity-40" : "",
          ].join(" ")}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          {marker === "before" ? <span aria-hidden className="absolute -top-px left-2 right-2 h-0.5 rounded bg-[#2a78d6]" /> : null}
          {marker === "after" ? <span aria-hidden className="absolute -bottom-px left-2 right-2 h-0.5 rounded bg-[#2a78d6]" /> : null}
          <button
            type="button"
            onClick={() => toggle(p.id, !isOpen)}
            aria-label={isOpen ? t("Collapse") : t("Expand")}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] text-[#a39a89] hover:bg-black/5 ${kids.length ? "" : "invisible"}`}
          >
            <span className={`transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
          </button>
          <Link href={`/pages/${p.id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5">
            <span aria-hidden className="w-5 shrink-0 text-center">
              {p.icon || defaultIcon(p.kind)}
            </span>
            <span className={`truncate ${p.title ? "" : "text-[#a39a89]"}`}>{p.title || t("Untitled")}</span>
          </Link>
          <span className="hidden shrink-0 items-center group-hover:flex group-focus-within:flex">
            <button
              type="button"
              onClick={() => setMenu(menu === p.id ? null : p.id)}
              aria-label={t("Page actions")}
              className="h-6 w-6 rounded text-[#8f8676] hover:bg-black/5 hover:text-[#1f1c17]"
            >
              ⋯
            </button>
            <button
              type="button"
              onClick={() => void add(p.id, "doc")}
              aria-label={t("Add a page inside")}
              title={t("Add a page inside")}
              className="h-6 w-6 rounded text-[#8f8676] hover:bg-black/5 hover:text-[#1f1c17]"
            >
              +
            </button>
          </span>
          {menu === p.id ? (
            <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-black/10 bg-white p-1 text-sm shadow-lg" onMouseLeave={() => setMenu(null)}>
              <button type="button" onClick={() => void add(p.id, "doc")} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[#faf8f2]">
                📄 {t("Add subpage")}
              </button>
              <button type="button" onClick={() => void add(p.id, "table")} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[#faf8f2]">
                ▦ {t("Add table inside")}
              </button>
              <button type="button" onClick={() => void onDelete(p)} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-rose-700 hover:bg-rose-50">
                🗑 {t("Delete")}
              </button>
            </div>
          ) : null}
        </div>
        {isOpen && kids.length ? (
          <ul>
            {kids.map((k) => renderRow(k, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  }

  const top = childrenOf(null);
  return (
    <nav aria-label={t("Life")} className="space-y-2">
      <Link
        href="/pages"
        className={`block rounded-lg px-2 py-1.5 text-sm font-semibold ${pathname === "/pages" ? "bg-[#efe9dc] text-[#1f1c17]" : "text-[#1f1c17] hover:bg-[#f4efe4]"}`}
      >
        🧬 {t("Life")}
      </Link>
      {!isLoaded ? (
        <p className="px-2 text-xs text-[#8f8676]">{t("Loading…")}</p>
      ) : top.length ? (
        <ul>
          {top.map((p) => renderRow(p, 0))}
        </ul>
      ) : (
        <p className="px-2 text-xs text-[#8f8676]">{t("No pages yet.")}</p>
      )}
      <div className="flex gap-1 border-t border-black/5 pt-2">
        <button type="button" onClick={() => void add(null, "doc")} className="flex-1 rounded-lg px-2 py-1.5 text-left text-xs text-[#6f675b] hover:bg-[#f4efe4] hover:text-[#1f1c17]">
          + {t("New page")}
        </button>
        <button type="button" onClick={() => void add(null, "table")} className="rounded-lg px-2 py-1.5 text-xs text-[#6f675b] hover:bg-[#f4efe4] hover:text-[#1f1c17]">
          + {t("Table")}
        </button>
      </div>
    </nav>
  );
}
