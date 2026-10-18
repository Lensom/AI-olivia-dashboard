"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/components/auth/require-auth";
import { LIBRARY_EXTRA_PAGES, LIBRARY_KINDS } from "@/features/library/nav";
import {
  investingPageStack,
  investingTabNavWrap,
  investingTabPillActive,
  investingTabPillIdle,
} from "@/features/investing/ui/investing-classes";
import { LibraryProvider } from "@/state/library-store";

const TABS = [
  { href: "/library", label: "Overview" },
  ...[...LIBRARY_KINDS, ...LIBRARY_EXTRA_PAGES].map((k) => ({ href: `/library/${k.slug}`, label: k.label })),
];

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <RequireAuth>
      <LibraryProvider>
        <div className={investingPageStack}>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">Library</p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">
              {TABS.find((t) => t.href !== "/library" && pathname.startsWith(t.href))?.label ?? "Everything you've read"}
            </h1>
          </div>
          <nav className={investingTabNavWrap} aria-label="Library">
            {TABS.map((tab) => (
              <Link key={tab.href} href={tab.href} className={pathname === tab.href ? investingTabPillActive : investingTabPillIdle}>
                {tab.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </LibraryProvider>
    </RequireAuth>
  );
}
