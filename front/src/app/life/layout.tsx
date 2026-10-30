"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LIFE_PAGES } from "@/features/life/nav";
import { investingTabNavWrap, investingTabPillActive, investingTabPillIdle } from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";

export default function LifeLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <div className="space-y-5">
      <nav className={investingTabNavWrap} aria-label={t("Life")}>
        {LIFE_PAGES.map((p) => (
          <Link key={p.slug} href={`/life/${p.slug}`} className={pathname === `/life/${p.slug}` ? investingTabPillActive : investingTabPillIdle}>
            {t(p.label)}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
