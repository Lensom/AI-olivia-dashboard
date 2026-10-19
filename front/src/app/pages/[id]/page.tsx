"use client";

import type { Block, BlockNoteEditor, PartialBlock } from "@blocknote/core";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { TableEditor } from "@/features/pages/table-editor";
import { defaultIcon, emptyTable, type Page, type TableContent } from "@/features/pages/types";
import { apiFetch } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { usePages } from "@/state/pages-store";

// The editor touches the DOM, so it only runs in the browser.
const DocEditor = dynamic(() => import("@/features/pages/doc-editor"), { ssr: false });

const ICONS = [
  "📄", "📝", "📚", "🎓", "🧠", "💡", "🎯", "🏆", "📅", "✅", "🗂️", "📌",
  "💰", "🏦", "📈", "🛒", "🎁", "🏠", "🚗", "✈️", "🗺️", "🍽️", "🍉", "☕",
  "💪", "🏃", "🧘", "💊", "❤️", "👨‍👩‍👧", "👶", "🐶", "🎨", "🎸", "🎮", "📷",
  "💻", "📱", "🔧", "🌱", "⭐", "🔥", "🌍", "🇺🇦", "🇷🇴", "🧬", "👕", "🎬",
];

const SAVE_MS = 700;

export default function LifePage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const router = useRouter();
  const { token } = useAuth();
  const { byId, childrenOf, patch, create, remove, isLoaded } = usePages();
  const [page, setPage] = useState<Page | null>(null);
  const [missing, setMissing] = useState(false);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const [iconOpen, setIconOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState("");
  const editorRef = useRef<BlockNoteEditor | null>(null);
  const timer = useRef<number | null>(null);
  const titleTimer = useRef<number | null>(null);
  const pending = useRef<unknown>(undefined);
  const mdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    apiFetch<Page>(`/pages/${id}`, { token })
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        setTitle(p.title);
        setMissing(false);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  const flush = useCallback(async () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === undefined) return;
    const content = pending.current;
    pending.current = undefined;
    setStatus("saving");
    try {
      await patch(id, { content });
      setPage((p) => (p ? { ...p, content } : p));
      setStatus(pending.current === undefined ? "saved" : "unsaved");
    } catch {
      pending.current = pending.current ?? content;
      setStatus("error");
    }
  }, [id, patch]);

  const queue = useCallback(
    (content: unknown) => {
      pending.current = content;
      setStatus("unsaved");
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), SAVE_MS);
    },
    [flush],
  );

  // Save what's typed before leaving the page or closing the tab.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (pending.current !== undefined) e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      void flush();
    };
  }, [flush]);

  const onReady = useCallback((editor: BlockNoteEditor) => {
    editorRef.current = editor;
  }, []);

  if (missing) {
    return (
      <div className="space-y-3 text-sm text-[#655d51]">
        <p>{t("This page doesn’t exist or was deleted.")}</p>
        <Link href="/pages" className="underline">
          {t("Back to Life")}
        </Link>
      </div>
    );
  }
  if (!page || !isLoaded) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;

  const summary = byId.get(id);
  const crumbs: { id: string; title: string; icon: string }[] = [];
  for (let p = summary?.parent_id ? byId.get(summary.parent_id) : undefined; p; p = p.parent_id ? byId.get(p.parent_id) : undefined) {
    crumbs.unshift({ id: p.id, title: p.title || t("Untitled"), icon: p.icon || defaultIcon(p.kind) });
  }
  const icon = summary?.icon ?? page.icon;
  const subpages = childrenOf(id);

  function saveTitle(next: string) {
    setTitle(next);
    // Saved once typing pauses (the tree updates then too); saves run in order, so the last one wins.
    if (titleTimer.current) window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => {
      titleTimer.current = null;
      void patch(id, { title: next }).catch(() => setStatus("error"));
    }, 400);
  }

  async function addSub(kind: "doc" | "table") {
    const p = await create({ parent_id: id, kind, content: kind === "table" ? emptyTable(t) : null });
    router.push(`/pages/${p.id}`);
  }

  async function importMarkdown(file: File) {
    const editor = editorRef.current;
    if (!editor) return;
    const md = await file.text();
    const blocks = editor.tryParseMarkdownToBlocks(md);
    // Notion exports start with "# Page title": use it as the title instead of repeating it.
    const first = blocks[0] as Block | undefined;
    const firstText = first?.type === "heading" ? (first.content as { text?: string }[] | undefined)?.map((c) => c.text ?? "").join("") : "";
    const rest = firstText ? blocks.slice(1) : blocks;
    if (firstText && !title.trim()) saveTitle(firstText);
    const empty = editor.document.length <= 1 && !(editor.document[0]?.content as unknown[] | undefined)?.length;
    if (empty) editor.replaceBlocks(editor.document, rest);
    else editor.insertBlocks(rest, editor.document[editor.document.length - 1]!, "after");
    if (mdRef.current) mdRef.current.value = "";
    setMenuOpen(false);
  }

  function exportMarkdown() {
    const editor = editorRef.current;
    if (!editor) return;
    const md = `# ${title || t("Untitled")}\n\n${editor.blocksToMarkdownLossy(editor.document)}`;
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "page").replace(/[\\/:*?"<>|]+/g, " ").trim()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  }

  async function onDelete() {
    setMenuOpen(false);
    const name = title || t("Untitled");
    if (!window.confirm(subpages.length ? t("Delete “{title}” and its subpages?", { title: name }) : t("Delete “{title}”?", { title: name }))) return;
    pending.current = undefined;
    await remove(id);
    router.push(crumbs.length ? `/pages/${crumbs[crumbs.length - 1]!.id}` : "/pages");
  }

  const statusText = { saved: t("Saved"), saving: t("Saving…"), unsaved: t("Unsaved changes"), error: t("Couldn’t save — check connection") }[status];

  return (
    <article className={page.kind === "table" ? "mx-auto max-w-[1200px]" : "mx-auto max-w-[900px]"}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs text-[#8f8676]">
        <nav aria-label={t("Breadcrumbs")} className="flex min-w-0 flex-wrap items-center gap-1">
          <Link href="/pages" className="hover:text-[#1f1c17]">
            {t("Life")}
          </Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <span aria-hidden>/</span>
              <Link href={`/pages/${c.id}`} className="truncate hover:text-[#1f1c17]">
                {c.icon} {c.title}
              </Link>
            </span>
          ))}
        </nav>
        <span className="flex items-center gap-2">
          <span className={status === "error" ? "text-rose-700" : status === "saved" ? "" : "text-amber-700"} role="status" aria-live="polite">
            {statusText}
          </span>
          <span className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t("Page actions")}
              className="rounded-md px-2 py-0.5 text-base leading-none text-[#8f8676] hover:bg-black/5 hover:text-[#1f1c17]"
            >
              ⋯
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-black/10 bg-white p-1 text-sm text-[#2f2922] shadow-lg" onMouseLeave={() => setMenuOpen(false)}>
                {page.kind === "doc" ? (
                  <>
                    <button type="button" onClick={() => mdRef.current?.click()} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[#faf8f2]">
                      ⬆ {t("Import Markdown (Notion export)")}
                    </button>
                    <button type="button" onClick={exportMarkdown} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[#faf8f2]">
                      ⬇ {t("Export as Markdown")}
                    </button>
                  </>
                ) : null}
                <button type="button" onClick={() => void addSub("doc")} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[#faf8f2]">
                  📄 {t("Add subpage")}
                </button>
                <button type="button" onClick={() => void addSub("table")} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-[#faf8f2]">
                  ▦ {t("Add table inside")}
                </button>
                <button type="button" onClick={() => void onDelete()} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-rose-700 hover:bg-rose-50">
                  🗑 {t("Delete page")}
                </button>
              </div>
            ) : null}
          </span>
        </span>
        <input
          ref={mdRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importMarkdown(f);
          }}
        />
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setIconOpen((v) => !v)}
          className="rounded-xl p-1 text-6xl leading-none transition hover:bg-black/5"
          aria-label={t("Change icon")}
          title={t("Change icon")}
        >
          {icon || defaultIcon(page.kind)}
        </button>
        {iconOpen ? (
          <div className="absolute left-0 top-full z-30 mt-1 w-[340px] rounded-xl border border-black/10 bg-white p-2 shadow-lg" onMouseLeave={() => setIconOpen(false)}>
            <div className="grid grid-cols-8 gap-1">
              {ICONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    void patch(id, { icon: e });
                    setIconOpen(false);
                  }}
                  className="rounded-lg p-1 text-xl hover:bg-[#faf8f2]"
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 border-t border-black/5 pt-2">
              <input
                placeholder={t("Or paste any emoji")}
                maxLength={8}
                onKeyDown={(e) => {
                  const v = e.currentTarget.value.trim();
                  if (e.key === "Enter" && v) {
                    void patch(id, { icon: v });
                    setIconOpen(false);
                  }
                }}
                className="min-w-0 flex-1 rounded-lg border border-black/10 px-2 py-1 text-sm outline-none focus:border-black/25"
              />
              <button
                type="button"
                onClick={() => {
                  void patch(id, { icon: "" });
                  setIconOpen(false);
                }}
                className="text-xs text-[#8f8676] hover:text-[#1f1c17]"
              >
                {t("Remove")}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <input
        value={title}
        onChange={(e) => saveTitle(e.target.value)}
        placeholder={t("Untitled")}
        aria-label={t("Page title")}
        className="mt-3 w-full bg-transparent text-4xl font-bold text-[#1f1c17] outline-none placeholder:text-[#d4ccbd]"
      />

      {subpages.length ? (
        <ul className="mt-4 space-y-0.5">
          {subpages.map((s) => (
            <li key={s.id}>
              <Link href={`/pages/${s.id}`} className="inline-flex items-center gap-2 rounded-lg px-1.5 py-1 text-[15px] text-[#3b352d] underline decoration-black/15 underline-offset-4 hover:bg-[#f4efe4]">
                <span aria-hidden>{s.icon || defaultIcon(s.kind)}</span>
                {s.title || t("Untitled")}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        {page.kind === "table" ? (
          <TableEditor
            value={(page.content as TableContent | null) ?? emptyTable(t)}
            onChange={(next) => {
              setPage((p) => (p ? { ...p, content: next } : p));
              queue(next);
            }}
          />
        ) : (
          <DocEditor key={id} initial={(page.content as PartialBlock[] | null) ?? null} onChange={queue} onReady={onReady} />
        )}
      </div>
    </article>
  );
}
