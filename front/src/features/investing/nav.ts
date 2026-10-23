import type { Subcategory } from "@/state/categories-store";

/**
 * Single source of truth for Investing page names and links, used by the sidebar, the Stocks tab bar
 * and the "Investing page order" control. Order comes from the user's investing subcategories (DB),
 * so reordering applies everywhere; labels always come from here.
 */
export type InvestingNavItem = { slug: string; label: string; href: string };

const PAGES: Record<string, Omit<InvestingNavItem, "slug">> = {
  total: { label: "Total", href: "/investing/total" },
  dashboard: { label: "Overview", href: "/investing/dashboard" },
  table: { label: "Portfolio", href: "/investing/holdings" },
  finance: { label: "Finance", href: "/investing/finance" },
  picking: { label: "Watchlist", href: "/investing/picking" },
  activities: { label: "Activities", href: "/investing/activities" },
  analytics: { label: "Analytics", href: "/investing/analytics" },
  notes: { label: "Notes", href: "/investing/notes" },
  crypto: { label: "Crypto", href: "/investing/crypto" },
};

/** Used before subcategories load (and for any built-in page missing from the DB). */
export const DEFAULT_INVESTING_ORDER = [
  "dashboard",
  "table",
  "picking",
  "finance",
  "activities",
  "analytics",
  "notes",
  "crypto",
  "total",
] as const;

export function isBuiltInInvestingPage(slug: string): boolean {
  return slug in PAGES;
}

/** Link for an investing subcategory: built-in pages have their own route, custom ones live under /c/investing. */
export function investingPageHref(slug: string): string {
  return PAGES[slug]?.href ?? `/c/investing/${slug}`;
}

export function investingPageLabel(slug: string, fallback: string): string {
  return PAGES[slug]?.label ?? fallback;
}

/** Built-in pages in the user's order; any built-in page absent from `subs` is appended in default order. */
export function investingNavItems(subs: Subcategory[]): InvestingNavItem[] {
  const ordered = subs.map((s) => s.slug).filter(isBuiltInInvestingPage);
  for (const slug of DEFAULT_INVESTING_ORDER)
    if (!ordered.includes(slug)) ordered.push(slug);
  return ordered.map((slug) => ({ slug, ...PAGES[slug]! }));
}
