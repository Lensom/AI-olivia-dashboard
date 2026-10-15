"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { investingPageHref } from "@/features/investing/nav";
import { useCategories } from "@/state/categories-store";

type SubcategoriesSectionProps = {
  categorySlug: string;
};

function hrefForSubcategory(categorySlug: string, subSlug: string) {
  return categorySlug === "investing" ? investingPageHref(subSlug) : `/c/${categorySlug}/${subSlug}`;
}

export function SubcategoriesSection({ categorySlug }: SubcategoriesSectionProps) {
  const { categories, subcategoriesByCategoryId, refreshSubcategories, createSubcategory } =
    useCategories();

  const category = useMemo(
    () => categories.find((c) => c.slug === categorySlug),
    [categories, categorySlug],
  );

  const [isAdding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!category) return;
    void refreshSubcategories(category.id);
  }, [category?.id, refreshSubcategories]);

  const subs = category ? (subcategoriesByCategoryId[category.id] ?? []) : [];

  async function onAdd() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) {
      setError("Name is too short");
      return;
    }
    if (!category) return;
    try {
      await createSubcategory(category.id, trimmed);
      setName("");
      setAdding(false);
    } catch {
      setError("Failed to create subcategory");
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#1f1c17]">Subcategories</p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
        >
          Add subcategory
        </button>
      </div>

      {isAdding ? (
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="text-xs font-medium text-[#6f675b]">Subcategory name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/20"
                placeholder="e.g. Dashboard, Table, Notes…"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAdd}
                className="rounded-full bg-[#1f1c17] px-3.5 py-2 text-xs font-medium text-[#f8f4eb] transition hover:bg-[#2c2923]"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setName("");
                  setError(null);
                }}
                className="rounded-full border border-black/10 bg-white px-3.5 py-2 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
              >
                Cancel
              </button>
            </div>
          </div>
          {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        {subs.map((s) => (
          <Link
            key={s.id}
            href={hrefForSubcategory(categorySlug, s.slug)}
            className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)] transition hover:-translate-y-0.5 hover:bg-white"
          >
            <h3 className="text-lg font-semibold text-[#1f1c17]">{s.name}</h3>
            <p className="mt-2 text-sm text-[#655d51]">Open →</p>
          </Link>
        ))}
        {subs.length === 0 ? (
          <div className="rounded-2xl border border-black/5 bg-white/70 p-4 text-sm text-[#655d51]">
            No subcategories yet.
          </div>
        ) : null}
      </div>
    </section>
  );
}

