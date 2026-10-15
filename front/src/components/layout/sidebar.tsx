"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/state/auth-store";
import { investingNavItems, isBuiltInInvestingPage } from "@/features/investing/nav";
import { useCategories } from "@/state/categories-store";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const { categories, isLoading, subcategoriesByCategoryId, refreshSubcategories } = useCategories();

  useEffect(() => {
    if (!user) return;
    for (const cat of categories) void refreshSubcategories(cat.id);
  }, [user, categories, refreshSubcategories]);

  return (
    <aside className="hidden w-64 shrink-0 md:block">
      <div className="sticky top-[60px]">
        <div className="rounded-2xl border border-black/5 bg-white/70 p-3 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
          <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#8f8676]">
            Categories
          </p>
          <nav className="space-y-1">
            <Link
              href="/"
              className={[
                "flex items-center justify-between rounded-xl px-2.5 py-2 text-sm font-medium transition",
                isActive(pathname, "/")
                  ? "bg-[#f3efe5] text-[#1f1c17]"
                  : "text-[#6f675b] hover:bg-[#faf8f2] hover:text-[#1f1c17]",
              ].join(" ")}
            >
              <span>Home</span>
            </Link>

            {!user ? (
              <p className="px-2 pt-2 text-xs text-[#8f8676]">Login to see your categories</p>
            ) : isLoading ? (
              <p className="px-2 pt-2 text-xs text-[#8f8676]">Loading…</p>
            ) : (
              categories.map((cat) => {
                const href = ["investing", "habits", "finances"].includes(cat.slug)
                  ? `/${cat.slug}`
                  : `/c/${cat.slug}`;

                const active = isActive(pathname, href);
                const subs = subcategoriesByCategoryId[cat.id] ?? [];
                const showChildren = subs.length > 0;

                return (
                  <div key={cat.id} className="space-y-1">
                    <Link
                      href={href}
                      className={[
                        "flex items-center justify-between rounded-xl px-2.5 py-2 text-sm font-medium transition",
                        active
                          ? "bg-[#f3efe5] text-[#1f1c17]"
                          : "text-[#6f675b] hover:bg-[#faf8f2] hover:text-[#1f1c17]",
                      ].join(" ")}
                    >
                      <span className="truncate">{cat.name}</span>
                      {showChildren ? (
                        <span className="text-xs text-[#8f8676]">›</span>
                      ) : null}
                    </Link>

                    {showChildren ? (
                      <div className="ml-2 border-l border-black/5 pl-2">
                        {(cat.slug === "investing"
                          ? // Built-in pages share names/order with the Stocks tabs; custom subcategories follow.
                            [
                              ...investingNavItems(subs).map((item) => ({
                                key: item.slug,
                                name: item.label,
                                href: item.href,
                              })),
                              ...subs
                                .filter((s) => !isBuiltInInvestingPage(s.slug))
                                .map((s) => ({ key: String(s.id), name: s.name, href: `/c/${cat.slug}/${s.slug}` })),
                            ]
                          : subs.map((s) => ({ key: String(s.id), name: s.name, href: `/c/${cat.slug}/${s.slug}` }))
                        ).map((sub) => {
                          const childHref = sub.href;
                          const childActive = isActive(pathname, childHref);
                          return (
                            <Link
                              key={sub.key}
                              href={childHref}
                              className={[
                                "block rounded-lg px-2 py-1.5 text-xs font-medium transition",
                                childActive
                                  ? "bg-[#f3efe5] text-[#1f1c17]"
                                  : "text-[#7f7668] hover:bg-[#faf8f2] hover:text-[#1f1c17]",
                              ].join(" ")}
                            >
                              {sub.name}
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </nav>
        </div>

        <div className="mt-3 rounded-2xl border border-black/5 bg-[#f1ece1] p-4 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          <p className="text-xs font-semibold text-[#1f1c17]">Sources (soon)</p>
          <p className="mt-1 text-xs text-[#655d51]">
            Google Sheets, Notion, files — in one place.
          </p>
        </div>
      </div>
    </aside>
  );
}
