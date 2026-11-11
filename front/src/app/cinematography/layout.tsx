"use client";

import { TabNav } from "@/components/layout/tab-nav";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/components/auth/require-auth";
import { CINEMA_EXTRA_PAGES, CINEMA_KINDS } from "@/features/cinema/nav";
import {
  investingPageStack,
} from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";
import { CinemaProvider } from "@/state/cinema-store";
import { RatePrompt } from "@/features/cinema/rate-prompt";

const TABS = [
  { href: "/cinematography", label: "Overview" },
  ...[...CINEMA_KINDS, ...CINEMA_EXTRA_PAGES].map((k) => ({ href: `/cinematography/${k.slug}`, label: k.label })),
];

export default function CinematographyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <RequireAuth>
      <CinemaProvider>
        <div className={investingPageStack}>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Cinematography")}</p>
            <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">
              {t(TABS.find((x) => x.href !== "/cinematography" && pathname.startsWith(x.href))?.label ?? "Everything you've watched")}
            </h1>
          </div>
          <TabNav
            title={t("Cinematography")}
            tabs={TABS.map((tab) => ({ href: tab.href, label: t(tab.label), active: pathname === tab.href }))}
          />
          {children}
        </div>
        <RatePrompt />
      </CinemaProvider>
    </RequireAuth>
  );
}
