"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { investingNavItems } from "@/features/investing/nav";
import {
  investingPageStack,
  investingTabNavWrap,
  investingTabPillActive,
  investingTabPillIdle,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";
import { useCategories } from "@/state/categories-store";

function stockTabActive(pathname: string, href: string): boolean {
  if (href === "/investing/dashboard") {
    return pathname === "/investing/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function InvestingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { categories, subcategoriesByCategoryId } = useCategories();
  const t = useT();
  // Same names and order as the sidebar. Crypto and Total are separate workspaces, not Stocks tabs.
  const stockTabs = useMemo(() => {
    const investing = categories.find((c) => c.slug === "investing");
    const subs = investing ? (subcategoriesByCategoryId[investing.id] ?? []) : [];
    return investingNavItems(subs).filter((item) => item.slug !== "crypto" && item.slug !== "total");
  }, [categories, subcategoriesByCategoryId]);

  if (pathname === "/investing") {
    return <>{children}</>;
  }

  if (pathname.startsWith("/investing/crypto") || pathname.startsWith("/investing/total")) {
    return <>{children}</>;
  }

  return (
    <RequireAuth>
      <div className={investingPageStack}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Investing")}</p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Stocks")}</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-[#655d51]">
              {t("Equities: live quotes, target weights, trade history, refills, and research buckets — same tab pattern as Crypto.")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/investing/crypto" className={investingToolbarBtn}>
              {t("Crypto")}
            </Link>
            <Link href="/investing" className={investingToolbarBtn}>
              {t("Investing home")}
            </Link>
          </div>
        </div>

        <nav className={investingTabNavWrap} aria-label={t("Stocks workspace")}>
          {stockTabs.map((tab) => {
            const active = stockTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={active ? investingTabPillActive : investingTabPillIdle}
              >
                {t(tab.label)}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </RequireAuth>
  );
}
