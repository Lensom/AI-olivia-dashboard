"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/components/auth/require-auth";
import { CareerProvider, useCareer } from "@/features/life/career/store";
import { useT } from "@/lib/i18n";

const TABS = [
  { href: "/life/career", label: "This week" },
  { href: "/life/career/plan", label: "Weekly plan" },
  { href: "/life/career/applications", label: "Applications" },
  { href: "/life/career/jobs", label: "Jobs" },
  { href: "/life/career/learning", label: "Learning" },
  { href: "/life/career/guide", label: "Cheat sheets" },
];

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const { loaded, error } = useCareer();
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Life")}</p>
        <h1 className="mt-1.5 text-3xl font-semibold text-[#1f1c17]">{t("Career")}</h1>
        <p className="mt-1 text-sm text-[#6f675b]">{t("A Senior Frontend / Product Engineer offer from a sponsor in the Netherlands: the weekly plan, your applications and what to learn.")}</p>
      </div>
      <nav className="flex flex-wrap gap-1.5" aria-label={t("Career")}>
        {TABS.map((tab) => {
          const active = tab.href === "/life/career" ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${active ? "bg-[#1f1c17] text-[#f8f4eb]" : "border border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`}
            >
              {t(tab.label)}
            </Link>
          );
        })}
      </nav>
      {error ? <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert">{t(error)}</p> : null}
      {loaded ? children : <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>}
    </div>
  );
}

export default function CareerLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <CareerProvider>
        <Shell>{children}</Shell>
      </CareerProvider>
    </RequireAuth>
  );
}
