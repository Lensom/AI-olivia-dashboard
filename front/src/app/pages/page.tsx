"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { defaultIcon, emptyTable, type PageKind } from "@/features/pages/types";
import { useLocale, useT } from "@/lib/i18n";
import { usePages } from "@/state/pages-store";

export default function LifeHome() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { pages, childrenOf, create, isLoaded } = usePages();
  const top = childrenOf(null);
  const recent = [...pages].sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? "")).slice(0, 8);

  async function add(kind: PageKind) {
    const p = await create({ parent_id: null, kind, content: kind === "table" ? emptyTable(t) : null });
    router.push(`/pages/${p.id}`);
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-8">
      <div>
        <p className="text-6xl leading-none">🧬</p>
        <h1 className="mt-3 text-4xl font-bold text-[#1f1c17]">{t("Life")}</h1>
        <p className="mt-2 text-sm text-[#655d51]">
          {t("Notes, plans and lists about everything: learning, goals, family, purchases. Articles work like Notion — type “/” for headings, lists, quotes, tables; tables have columns, sums and sections.")}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void add("doc")} className="rounded-full bg-[#1f1c17] px-4 py-2 text-sm font-medium text-[#f8f4eb] hover:bg-[#2c2923]">
            📄 {t("New page")}
          </button>
          <button type="button" onClick={() => void add("table")} className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-medium text-[#3b352d] hover:bg-[#faf8f2]">
            ▦ {t("New table")}
          </button>
        </div>
      </div>

      {!isLoaded ? (
        <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>
      ) : !pages.length ? (
        <div className="rounded-2xl border border-dashed border-black/10 px-6 py-10 text-center text-sm text-[#6f675b]">
          {t("No pages yet. Start with an article like “Financial rules” or a table like “Purchases”. Pages can hold subpages, as deep as you like.")}
        </div>
      ) : (
        <>
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Pages")}</h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {top.map((p) => {
                const kids = childrenOf(p.id).length;
                return (
                  <li key={p.id}>
                    <Link href={`/pages/${p.id}`} className="flex items-center gap-3 rounded-xl border border-black/5 bg-[#fcfbf7] px-3 py-2.5 transition hover:bg-[#f4efe4]">
                      <span aria-hidden className="text-2xl">
                        {p.icon || defaultIcon(p.kind)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-[#1f1c17]">{p.title || t("Untitled")}</span>
                        <span className="block text-[11px] text-[#8f8676]">
                          {p.kind === "table" ? t("Table") : t("Page")}
                          {kids ? ` · ${t("{n} subpages", { n: kids })}` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Recently edited")}</h2>
            <ul className="divide-y divide-black/5">
              {recent.map((p) => (
                <li key={p.id}>
                  <Link href={`/pages/${p.id}`} className="flex items-center gap-2 px-1 py-2 text-sm hover:bg-[#faf8f2]">
                    <span aria-hidden>{p.icon || defaultIcon(p.kind)}</span>
                    <span className="min-w-0 flex-1 truncate text-[#2f2922]">{p.title || t("Untitled")}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[#8f8676]">
                      {p.updated_at ? new Date(p.updated_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
