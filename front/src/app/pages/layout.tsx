"use client";

import { notFound } from "next/navigation";
import { RequireAuth } from "@/components/auth/require-auth";
import { PageTree } from "@/features/pages/page-tree";
import { LIFE_PAGES_ENABLED } from "@/lib/features";
import { PagesProvider } from "@/state/pages-store";

export default function LifeLayout({ children }: { children: React.ReactNode }) {
  // Hidden for now (see lib/features.ts).
  if (!LIFE_PAGES_ENABLED) notFound();
  return (
    <RequireAuth>
      <PagesProvider>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-black/5 bg-white/70 p-3 shadow-[0_8px_30px_rgba(18,16,13,0.05)] lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-96px)] lg:overflow-y-auto">
            <PageTree />
          </aside>
          <main className="min-w-0 rounded-2xl border border-black/5 bg-white px-5 py-8 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:px-16">
            {children}
          </main>
        </div>
      </PagesProvider>
    </RequireAuth>
  );
}
