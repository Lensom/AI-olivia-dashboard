"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { categoryHref } from "@/lib/category-href";
import { isCategoryVisible } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { cinemaPageHref } from "@/features/cinema/nav";
import { libraryPageHref } from "@/features/library/nav";
import { investingNavItems, isBuiltInInvestingPage } from "@/features/investing/nav";
import { useCategories, type Category, type Subcategory } from "@/state/categories-store";

const OPEN_KEY = "olivia.sidebar.open.v1";
/** Categories that are a single page (no subpages to toggle). */
const SINGLE_PAGE = new Set(["tasks", "life"]);

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The category's own page first (so the title can toggle instead of navigate), then its pages. */
function childLinks(cat: Category, subs: Subcategory[]): { key: string; name: string; href: string; exact?: boolean }[] {
  if (cat.slug === "investing") {
    // Built-in pages share names/order with the Stocks tabs; custom subcategories follow.
    return [
      { key: "home", name: "Investing home", href: "/investing", exact: true },
      ...investingNavItems(subs).map((item) => ({ key: item.slug, name: item.label, href: item.href })),
      ...subs
        .filter((s) => !isBuiltInInvestingPage(s.slug))
        .map((s) => ({ key: String(s.id), name: s.name, href: `/c/${cat.slug}/${s.slug}` })),
    ];
  }
  const own = { key: "home", name: ["cinematography", "library"].includes(cat.slug) ? "Overview" : "All pages", href: categoryHref(cat.slug), exact: true };
  return [
    own,
    ...subs.map((s) => ({
      key: String(s.id),
      name: s.name,
      href:
        cat.slug === "cinematography"
          ? cinemaPageHref(s.slug)
          : cat.slug === "library"
            ? libraryPageHref(s.slug)
            : `/c/${cat.slug}/${s.slug}`,
    })),
  ];
}

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(window.localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const t = useT();
  const { user } = useAuth();
  const { categories, isLoading, subcategoriesByCategoryId, refreshSubcategories } = useCategories();
  // Categories you opened or closed yourself; the rest are open only while you're inside them.
  // Read lazily: the categories (and so this state's effect on the markup) only render after login loads.
  const [openState, setOpenState] = useState<Record<string, boolean>>(() => (typeof window === "undefined" ? {} : readOpen()));

  useEffect(() => {
    if (!user) return;
    for (const cat of categories) refreshSubcategories(cat.id).catch(() => {});
  }, [user, categories, refreshSubcategories]);

  function toggle(slug: string, open: boolean) {
    setOpenState((prev) => {
      const next = { ...prev, [slug]: !open };
      try {
        window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // Remembering is a convenience; toggling still works.
      }
      return next;
    });
  }

  return (
    <aside className="hidden w-64 shrink-0 md:block">
      <div className="sticky top-[60px]">
        <div className="rounded-2xl border border-black/5 bg-white/70 p-3 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
          <p className="px-2 pb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#8f8676]">
            {t("Categories")}
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
              <span>{t("Home")}</span>
            </Link>

            {!user ? (
              <p className="px-2 pt-2 text-xs text-[#8f8676]">{t("Login to see your categories")}</p>
            ) : isLoading ? (
              <p className="px-2 pt-2 text-xs text-[#8f8676]">{t("Loading…")}</p>
            ) : (
              categories.filter((cat) => isCategoryVisible(cat.slug)).map((cat) => {
                const href = categoryHref(cat.slug);
                const inside = isActive(pathname, href) || pathname.startsWith(`/c/${cat.slug}/`);
                const links = childLinks(cat, subcategoriesByCategoryId[cat.id] ?? []);
                const open = openState[cat.slug] ?? inside;
                const panelId = `sidebar-${cat.slug}`;

                if (SINGLE_PAGE.has(cat.slug)) {
                  // One page, nothing to show or hide: a plain link.
                  return (
                    <Link
                      key={cat.id}
                      href={href}
                      className={[
                        "flex items-center justify-between rounded-xl px-2.5 py-2 text-sm font-medium transition",
                        inside ? "bg-[#f3efe5] text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2] hover:text-[#1f1c17]",
                      ].join(" ")}
                    >
                      <span className="truncate">{t(cat.name)}</span>
                    </Link>
                  );
                }

                return (
                  <div key={cat.id} className="space-y-1">
                    <button
                      type="button"
                      onClick={() => toggle(cat.slug, open)}
                      aria-expanded={open}
                      aria-controls={panelId}
                      className={[
                        "flex w-full items-center justify-between rounded-xl px-2.5 py-2 text-left text-sm font-medium transition",
                        inside ? "text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2] hover:text-[#1f1c17]",
                        inside && !open ? "bg-[#f3efe5]" : "",
                      ].join(" ")}
                    >
                      <span className="truncate">{t(cat.name)}</span>
                      <span aria-hidden className={`text-xs text-[#8f8676] transition-transform ${open ? "rotate-90" : ""}`}>
                        ›
                      </span>
                    </button>

                    {open ? (
                      <div id={panelId} className="ml-2 border-l border-black/5 pl-2">
                        {links.map((sub) => {
                          const childActive = sub.exact ? pathname === sub.href : isActive(pathname, sub.href);
                          return (
                            <Link
                              key={sub.key}
                              href={sub.href}
                              className={[
                                "block rounded-lg px-2 py-1.5 text-xs font-medium transition",
                                childActive
                                  ? "bg-[#f3efe5] text-[#1f1c17]"
                                  : "text-[#7f7668] hover:bg-[#faf8f2] hover:text-[#1f1c17]",
                              ].join(" ")}
                            >
                              {t(sub.name)}
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
      </div>
    </aside>
  );
}
