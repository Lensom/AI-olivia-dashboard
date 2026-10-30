"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { cinemaPageHref } from "@/features/cinema/nav";
import { libraryPageHref } from "@/features/library/nav";
import { lifePageHref } from "@/features/life/nav";
import { investingPageHref } from "@/features/investing/nav";
import { useT } from "@/lib/i18n";
import { useCategories } from "@/state/categories-store";

type SubcategoriesSectionProps = {
  categorySlug: string;
};

function hrefForSubcategory(categorySlug: string, subSlug: string) {
  if (categorySlug === "investing") return investingPageHref(subSlug);
  if (categorySlug === "cinematography") return cinemaPageHref(subSlug);
  if (categorySlug === "library") return libraryPageHref(subSlug);
  if (categorySlug === "life") return lifePageHref(subSlug);
  return `/c/${categorySlug}/${subSlug}`;
}

export function SubcategoriesSection({ categorySlug }: SubcategoriesSectionProps) {
  const { categories, subcategoriesByCategoryId, refreshSubcategories, createSubcategory } =
    useCategories();

  const category = useMemo(
    () => categories.find((c) => c.slug === categorySlug),
    [categories, categorySlug],
  );

  const t = useT();
  const [isAdding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!category) return;
    refreshSubcategories(category.id).catch(() => {});
  }, [category?.id, refreshSubcategories]);

  const subs = category ? (subcategoriesByCategoryId[category.id] ?? []) : [];

  async function onAdd() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) {
      setError(t("Name is too short"));
      return;
    }
    if (!category) return;
    try {
      await createSubcategory(category.id, trimmed);
      setName("");
      setAdding(false);
    } catch {
      setError(t("Failed to create subcategory"));
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-[#1f1c17]">{t("Subcategories")}</p>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
        >
          {t("Add subcategory")}
        </button>
      </div>

      {isAdding ? (
        <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="text-xs font-medium text-[#6f675b]">{t("Subcategory name")}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/20"
                placeholder={t("e.g. Dashboard, Table, Notes…")}
              />
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAdd}
                className="rounded-full bg-[#1f1c17] px-3.5 py-2 text-xs font-medium text-[#f8f4eb] transition hover:bg-[#2c2923]"
              >
                {t("Create")}
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
                {t("Cancel")}
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
            <h3 className="text-lg font-semibold text-[#1f1c17]">{t(s.name)}</h3>
            <p className="mt-2 text-sm text-[#655d51]">{t("Open →")}</p>
          </Link>
        ))}
        {subs.length === 0 ? (
          <div className="rounded-2xl border border-black/5 bg-white/70 p-4 text-sm text-[#655d51]">
            {t("No subcategories yet.")}
          </div>
        ) : null}
      </div>
    </section>
  );
}

