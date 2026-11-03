"use client";

import { TabNav } from "@/components/layout/tab-nav";
import { usePathname } from "next/navigation";
import { LIFE_PAGES } from "@/features/life/nav";
import { useT } from "@/lib/i18n";

export default function LifeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="space-y-5">
      <TabNav
        title={t("Life")}
        tabs={LIFE_PAGES.map((p) => ({ href: `/life/${p.slug}`, label: t(p.label), active: pathname === `/life/${p.slug}` }))}
      />
      {children}
    </div>
  );
}
