"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/components/auth/require-auth";
import {
  investingPageStack,
  investingTabNavWrap,
  investingTabPillActive,
  investingTabPillIdle,
  investingToolbarBtn,
} from "@/features/investing/ui/investing-classes";

const STOCK_TABS = [
  { href: "/investing/dashboard", label: "Overview" },
  { href: "/investing/holdings", label: "Portfolio" },
  { href: "/investing/finance", label: "Finance" },
  { href: "/investing/picking", label: "Allocation rules" },
  { href: "/investing/activities", label: "Activities" },
  { href: "/investing/analytics", label: "Analytics" },
  { href: "/investing/notes", label: "Notes" },
] as const;

function stockTabActive(pathname: string, href: string): boolean {
  if (href === "/investing/dashboard") {
    return pathname === "/investing/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function InvestingLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/investing") {
    return <>{children}</>;
  }

  if (pathname.startsWith("/investing/crypto")) {
    return <>{children}</>;
  }

  return (
    <RequireAuth>
      <div className={investingPageStack}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">Investing</p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">Stocks</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-[#655d51]">
              Equities: live quotes, target weights, trade history, refills, and research buckets — same tab pattern
              as Crypto.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/investing/crypto" className={investingToolbarBtn}>
              Crypto
            </Link>
            <Link href="/investing" className={investingToolbarBtn}>
              Investing home
            </Link>
          </div>
        </div>

        <nav className={investingTabNavWrap} aria-label="Stocks workspace">
          {STOCK_TABS.map((tab) => {
            const active = stockTabActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={active ? investingTabPillActive : investingTabPillIdle}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {children}
      </div>
    </RequireAuth>
  );
}
