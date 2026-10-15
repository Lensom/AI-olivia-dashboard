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
import { CryptoProvider } from "@/state/crypto-store";

const TABS = [
  { href: "/investing/crypto", label: "Overview", exact: true },
  { href: "/investing/crypto/holdings", label: "Portfolio" },
  { href: "/investing/crypto/ledger", label: "Funding & buys" },
  { href: "/investing/crypto/rules", label: "Allocation rules" },
] as const;

export default function CryptoLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <CryptoProvider>
      <RequireAuth>
        <div className={investingPageStack}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">Investing</p>
              <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">Crypto</h1>
              <p className="mt-1.5 max-w-2xl text-sm text-[#655d51]">
                Coins you hold, what they cost, UAH→USD funding and the BTC / ETH split for new deposits. Prices from
                Yahoo Finance, with CoinGecko as a fallback.
              </p>
            </div>
            <Link href="/investing" className={investingToolbarBtn}>
              Back to Investing
            </Link>
          </div>

          <nav className={investingTabNavWrap} aria-label="Crypto workspace">
            {TABS.map((tab) => {
              const active = "exact" in tab && tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
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
    </CryptoProvider>
  );
}
