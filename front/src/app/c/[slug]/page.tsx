"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { SubcategoriesSection } from "@/components/categories/subcategories-section";
import { useT } from "@/lib/i18n";
import { useCategories } from "@/state/categories-store";

export default function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const { categories } = useCategories();
  const t = useT();

  const category = useMemo(() => categories.find((c) => c.slug === slug), [categories, slug]);

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">
            {t("Category")}
          </p>
          <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">
            {category ? t(category.name) : slug}
          </h1>
          <p className="mt-1.5 text-sm text-[#655d51]">
            {t("Subcategories are saved per user and category.")}
          </p>
        </div>

        <SubcategoriesSection categorySlug={slug} />

        <Link
          href="/"
          className="inline-flex rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
        >
          {t("Back to categories")}
        </Link>
      </div>
    </RequireAuth>
  );
}

