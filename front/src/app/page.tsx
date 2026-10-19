"use client";

import Link from "next/link";
import { useState } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { useT } from "@/lib/i18n";
import { useCategories } from "@/state/categories-store";

export default function Home() {
  const { categories, isLoading, create } = useCategories();
  const [isAdding, setAdding] = useState(false);
  const t = useT();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onAdd() {
    setError(null);
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t("Name is too short"));
      return;
    }
    try {
      await create(trimmed);
      setName("");
      setAdding(false);
    } catch {
      setError(t("Failed to create category"));
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">
              {t("Home")}
            </p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Categories")}</h1>
            <p className="mt-1.5 text-sm text-[#655d51]">
              {t("Your categories are saved per user.")}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-xs font-medium text-[#f8f4eb] transition hover:bg-[#2c2923]"
          >
            {t("Add category")}
          </button>
        </div>

        {isAdding ? (
          <div className="rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="flex-1">
                <span className="text-xs font-medium text-[#6f675b]">{t("Category name")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/20"
                  placeholder={t("e.g. Health, Learning, Projects…")}
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

        <section className="grid gap-4 md:grid-cols-2">
          {isLoading ? (
            <div className="rounded-2xl border border-black/5 bg-white/70 p-5 text-sm text-[#655d51]">
              {t("Loading…")}
            </div>
          ) : null}

          {categories.map((cat) => {
            const href = ["investing", "cinematography", "library", "tasks"].includes(cat.slug)
              ? `/${cat.slug}`
              : `/c/${cat.slug}`;

            return (
              <Link
                key={cat.id}
                href={href}
                className="group rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)] transition hover:-translate-y-0.5 hover:bg-white"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#938979]">
                      {t("Category")}
                    </p>
                    <h2 className="mt-1.5 text-lg font-semibold text-[#1f1c17]">
                      {t(cat.name)}
                    </h2>
                    <p className="mt-2 text-sm text-[#655d51]">
                      {t("Open workspace →")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-black/10 bg-[#faf8f2] px-2.5 py-1 text-xs font-medium text-[#6f675b]">
                    {cat.slug}
                  </span>
                </div>
              </Link>
            );
          })}
        </section>
      </div>
    </RequireAuth>
  );
}
