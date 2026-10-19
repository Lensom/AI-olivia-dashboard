"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { AttentionStrip } from "@/features/investing/attention-strip";
import { formatUsd, parseUsd } from "@/features/investing/format";
import { investingPageHref, investingPageLabel } from "@/features/investing/nav";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useCategories, type Subcategory } from "@/state/categories-store";
import { useT } from "@/lib/i18n";
import { useInvesting } from "@/state/investing-store";

const DESCRIPTION: Record<string, string> = {
  total: "Net worth across stocks, crypto, savings and debts",
  dashboard: "Today's moves, allocation, risk and rebalancing",
  table: "Holdings table, import, targets",
  finance: "Deposits, fees and annualized return",
  picking: "Buckets and buy zones",
  activities: "Every buy and sell, import from broker",
  analytics: "Yearly returns vs the S&P 500",
  notes: "Your rules, checked against live numbers",
  crypto: "BTC / ETH holdings, funding and split rule",
};

export default function InvestingPage() {
  const { categories, subcategoriesByCategoryId, refreshSubcategories, reorderSubcategories, createSubcategory } =
    useCategories();
  const { holdings, refills, activities, pickingRows, notes } = useInvesting();
  const t = useT();
  const investing = useMemo(() => categories.find((c) => c.slug === "investing"), [categories]);
  const saved = useMemo(
    () => (investing ? (subcategoriesByCategoryId[investing.id] ?? []) : []),
    [investing, subcategoriesByCategoryId],
  );

  const [reordering, setReordering] = useState(false);
  // Local order while reordering, so tiles move instantly; saved to the server after each change.
  const [draft, setDraft] = useState<Subcategory[] | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (investing?.id) void refreshSubcategories(investing.id);
  }, [investing?.id, refreshSubcategories]);

  const tiles = draft ?? saved;

  // A live figure per page where the data is already loaded (stocks data is app-wide).
  const metric = useMemo(() => {
    const value = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const topped = refills.reduce((a, r) => a + parseUsd(r.amount), 0);
    const words = notes.trim() ? notes.trim().split(/\s+/).length : 0;
    return {
      dashboard: value > 0 ? formatUsd(value) : null,
      table: holdings.length ? t("{n} holdings", { n: holdings.length }) : null,
      finance: topped > 0 ? t("{v} deposited", { v: formatUsd(topped) }) : null,
      activities: activities.length ? t("{n} trades", { n: activities.length }) : null,
      picking: pickingRows.length ? t("{n} on the list", { n: pickingRows.length }) : null,
      notes: words ? t("{n} words", { n: words }) : null,
    } as Record<string, string | null>;
  }, [holdings, refills, activities, pickingRows, notes, t]);

  async function commit(next: Subcategory[]) {
    if (!investing) return;
    setDraft(next);
    setBusy(true);
    setError(null);
    try {
      await reorderSubcategories(
        investing.id,
        next.map((s) => s.id),
      );
    } catch {
      setError("Couldn't save the new order.");
      setDraft(null);
      await refreshSubcategories(investing.id);
    } finally {
      setBusy(false);
    }
  }

  function moveTo(id: number, toIndex: number) {
    const from = tiles.findIndex((s) => s.id === id);
    if (from < 0 || toIndex < 0 || toIndex >= tiles.length || from === toIndex) return;
    const next = [...tiles];
    const [item] = next.splice(from, 1);
    next.splice(toIndex, 0, item!);
    return next;
  }

  async function addPage() {
    if (!investing || newName.trim().length < 2) return;
    try {
      await createSubcategory(investing.id, newName.trim());
      setNewName("");
      setAdding(false);
    } catch {
      setError("Couldn't create the page.");
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Category")}</p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Investing")}</h1>
            <p className="mt-1.5 text-sm text-[#655d51]">
              {reordering
                ? t("Drag tiles (or use the arrows) to set the order. It applies to the sidebar and the Stocks tabs.")
                : t("What needs your attention, and your investing pages in sidebar order.")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {busy ? <span className="text-xs text-[#8f8676]">{t("Saving…")}</span> : null}
            <button
              type="button"
              onClick={() => {
                setReordering((v) => !v);
                setDraft(null);
                setAdding(false);
              }}
              className={
                reordering
                  ? "rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-xs font-medium text-[#f8f4eb] hover:bg-[#2c2923]"
                  : investingToolbarBtn
              }
            >
              {reordering ? t("Done") : t("Reorder")}
            </button>
          </div>
        </div>
        {error ? <p className="text-sm text-rose-700">{t(error)}</p> : null}

        {reordering ? null : <AttentionStrip />}

        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("Investing pages")}>
          {tiles.map((s, index) => {
            const href = investingPageHref(s.slug);
            const label = t(investingPageLabel(s.slug, s.name));
            const isDragging = dragId === s.id;
            const body = (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[15px] font-semibold text-[#1f1c17]">{label}</span>
                  {reordering ? (
                    <span className="select-none text-lg leading-none text-[#b0a79a]" aria-hidden>
                      ⠿
                    </span>
                  ) : metric[s.slug] ? (
                    <span className="shrink-0 rounded-full bg-[#f4efe4] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#3b352d]">
                      {metric[s.slug]}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-[#6f675b]">{t(DESCRIPTION[s.slug] ?? "Custom page")}</p>
              </>
            );
            return (
              <li
                key={s.id}
                draggable={reordering}
                onDragStart={(e) => {
                  setDragId(s.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (!reordering || dragId == null || dragId === s.id) return;
                  e.preventDefault();
                  const next = moveTo(dragId, index);
                  if (next) setDraft(next); // live preview while dragging
                }}
                onDrop={(e) => e.preventDefault()}
                onDragEnd={() => {
                  setDragId(null);
                  if (draft && draft.map((d) => d.id).join() !== saved.map((d) => d.id).join()) void commit(draft);
                }}
                className={[
                  "rounded-2xl border bg-white/90 shadow-[0_8px_30px_rgba(18,16,13,0.05)] transition",
                  reordering ? "cursor-grab border-dashed border-black/15 active:cursor-grabbing" : "border-black/5",
                  isDragging ? "opacity-50" : "",
                ].join(" ")}
              >
                {reordering ? (
                  <div className="flex items-center gap-3 p-4">
                    <span className="w-5 text-center text-xs tabular-nums text-[#b0a79a]">{index + 1}</span>
                    <div className="min-w-0 flex-1">{body}</div>
                    <span className="flex flex-col gap-1">
                      {[
                        { d: -1, label: "↑", aria: t("Move {page} earlier", { page: label }) },
                        { d: 1, label: "↓", aria: t("Move {page} later", { page: label }) },
                      ].map(({ d, label: arrow, aria }) => (
                        <button
                          key={d}
                          type="button"
                          disabled={busy || index + d < 0 || index + d >= tiles.length}
                          onClick={() => {
                            const next = moveTo(s.id, index + d);
                            if (next) void commit(next);
                          }}
                          className="rounded-md border border-black/10 bg-white px-1.5 text-xs leading-5 text-[#3b352d] hover:bg-[#faf8f2] disabled:opacity-30"
                          aria-label={aria}
                        >
                          {arrow}
                        </button>
                      ))}
                    </span>
                  </div>
                ) : (
                  <Link href={href} className="block rounded-2xl p-4 hover:bg-white">
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
          {tiles.length === 0 ? <li className="text-sm text-[#8f8676]">{t("Loading pages…")}</li> : null}
        </ul>

        {reordering ? (
          adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addPage()}
                placeholder={t("Page name")}
                className="w-56 rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-sm outline-none focus:border-black/20"
                autoFocus
              />
              <button type="button" onClick={() => void addPage()} className={investingToolbarBtn}>
                {t("Add")}
              </button>
              <button type="button" onClick={() => setAdding(false)} className="text-xs text-[#6f675b] hover:text-[#1f1c17]">
                {t("Cancel")}
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="text-xs text-[#6f675b] underline decoration-black/15 underline-offset-2 hover:text-[#1f1c17]">
              + {t("Add a custom page")}
            </button>
          )
        ) : null}
      </div>
    </RequireAuth>
  );
}
