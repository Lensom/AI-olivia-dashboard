"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { categoryLook, ChevronIcon, HomeIcon } from "@/components/layout/icons";
import { categoryHref } from "@/lib/category-href";
import { isCategoryVisible } from "@/lib/features";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { cinemaPageHref } from "@/features/cinema/nav";
import { libraryPageHref } from "@/features/library/nav";
import { lifePageHref } from "@/features/life/nav";
import { investingNavItems, isBuiltInInvestingPage } from "@/features/investing/nav";
import { useCategories, type Category, type Subcategory } from "@/state/categories-store";

const OPEN_KEY = "olivia.sidebar.open.v1";
/** Categories that are a single page (no subpages to toggle). */
const SINGLE_PAGE = new Set(["tasks"]);

const rowBase = "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition";
const rowActive = "bg-[#1f1c17]/[0.06] text-[#1f1c17]";
const rowIdle = "text-[#5f584d] hover:bg-black/[0.035] hover:text-[#1f1c17]";

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The category's own page first (so the title can toggle instead of navigate), then its pages. */
export function childLinks(cat: Category, subs: Subcategory[]): { key: string; name: string; href: string; exact?: boolean }[] {
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
  if (cat.slug === "life") {
    // No overview: just its pages (/life opens the first one).
    return subs.map((s) => ({ key: String(s.id), name: s.name, href: lifePageHref(s.slug) }));
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

/** The category tree. Used by the desktop sidebar and the mobile menu (which closes on `onNavigate`). */
export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useT();
  const { user, token } = useAuth();
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
    <nav className="space-y-0.5" aria-label={t("Categories")}>
      <Link href="/" onClick={onNavigate} aria-current={pathname === "/" ? "page" : undefined} className={`${rowBase} ${pathname === "/" ? rowActive : rowIdle}`}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#1f1c17] text-[#f8f4eb]">
          <HomeIcon className="h-3.5 w-3.5" />
        </span>
        <span>{t("Home")}</span>
      </Link>

      {!token ? (
        <p className="px-2.5 pt-2 text-xs text-[#8f8676]">{t("Login to see your categories")}</p>
      ) : isLoading && categories.length === 0 ? (
        <div className="space-y-1.5 px-2.5 pt-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-7 animate-pulse rounded-lg bg-black/[0.04]" />
          ))}
        </div>
      ) : (
        categories.filter((cat) => isCategoryVisible(cat.slug)).map((cat) => {
          const href = categoryHref(cat.slug);
          const inside = isActive(pathname, href) || pathname.startsWith(`/c/${cat.slug}/`);
          const links = childLinks(cat, subcategoriesByCategoryId[cat.id] ?? []);
          const open = openState[cat.slug] ?? inside;
          const panelId = `sidebar-${cat.slug}`;
          const { Icon, tile } = categoryLook(cat.slug);
          const icon = (
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${tile}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          );

          if (SINGLE_PAGE.has(cat.slug)) {
            // One page, nothing to show or hide: a plain link.
            return (
              <Link key={cat.id} href={href} onClick={onNavigate} aria-current={inside ? "page" : undefined} className={`${rowBase} ${inside ? rowActive : rowIdle}`}>
                {icon}
                <span className="truncate">{t(cat.name)}</span>
              </Link>
            );
          }

          return (
            <div key={cat.id}>
              <button
                type="button"
                onClick={() => toggle(cat.slug, open)}
                aria-expanded={open}
                aria-controls={panelId}
                className={`${rowBase} ${inside ? "text-[#1f1c17]" : rowIdle} ${inside && !open ? rowActive : ""}`}
              >
                {icon}
                <span className="flex-1 truncate">{t(cat.name)}</span>
                <ChevronIcon className={`h-3.5 w-3.5 text-[#a39a89] transition-transform ${open ? "rotate-90" : ""}`} />
              </button>

              {open ? (
                <div id={panelId} className="mb-1 ml-[1.35rem] mt-0.5 space-y-px border-l border-black/[0.07] pl-3">
                  {links.map((sub) => {
                    const childActive = sub.exact ? pathname === sub.href : isActive(pathname, sub.href);
                    return (
                      <Link
                        key={sub.key}
                        href={sub.href}
                        onClick={onNavigate}
                        aria-current={childActive ? "page" : undefined}
                        className={[
                          "relative block rounded-lg px-2 py-1.5 text-[13px] transition",
                          childActive
                            ? "bg-[#1f1c17]/[0.06] font-medium text-[#1f1c17] before:absolute before:-left-[13px] before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-[#1f1c17]"
                            : "text-[#7f7668] hover:bg-black/[0.035] hover:text-[#1f1c17]",
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
  );
}

export function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 md:block">
      <div className="sticky top-[76px] max-h-[calc(100vh-96px)] overflow-y-auto rounded-2xl border border-black/5 bg-white/60 p-2.5 shadow-[0_8px_30px_rgba(18,16,13,0.04)]">
        <SidebarNav />
      </div>
    </aside>
  );
}
