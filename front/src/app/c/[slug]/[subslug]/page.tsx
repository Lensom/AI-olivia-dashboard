"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { categoryHref } from "@/lib/category-href";
import { useT } from "@/lib/i18n";

export default function SubcategoryPage() {
  const { slug, subslug } = useParams<{ slug: string; subslug: string }>();
  const t = useT();

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Subcategory")}</p>
        <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{subslug}</h1>
        <p className="mt-1.5 text-sm text-[#655d51]">
          {t("Under category")} <span className="font-medium text-[#1f1c17]">{slug}</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <p className="text-sm font-semibold text-[#1f1c17]">{t("Coming soon")}</p>
        <p className="mt-2 text-sm text-[#655d51]">{t("This is a placeholder page for a custom subcategory.")}</p>
      </div>

      <Link
        href={categoryHref(slug)}
        className="inline-flex rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
      >
        {t("Back")}
      </Link>
    </div>
  );
}
