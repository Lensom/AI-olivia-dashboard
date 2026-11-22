"use client";

import { TabNav } from "@/components/layout/tab-nav";
import { usePathname } from "next/navigation";
import { useJobsNews } from "@/features/life/career/jobs-news";
import { LIFE_PAGES } from "@/features/life/nav";
import { useT } from "@/lib/i18n";

export default function LifeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  // New vacancies worth a look show on Career, where Jobs now lives.
  const news = useJobsNews();
  return (
    <div className="space-y-5">
      <TabNav
        title={t("Life")}
        tabs={LIFE_PAGES.map((p) => ({ href: `/life/${p.slug}`, label: p.slug === "career" && news ? `${t(p.label)} ★ ${news}` : t(p.label), active: pathname === `/life/${p.slug}` || pathname.startsWith(`/life/${p.slug}/`) }))}
      />
      {children}
    </div>
  );
}
