"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BottomSheet, CheckIcon } from "@/components/layout/bottom-sheet";
import {
  investingTabPillActive,
  investingTabPillIdle,
} from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";

export type TabNavItem = { href: string; label: string; active: boolean };

/**
 * A section's tabs. Wider screens: a row of pills. Phones: one button with the current tab that opens
 * a bottom sheet listing every tab, instead of a row you have to swipe through.
 * `label`s and `title` are already translated.
 */
export function TabNav({ tabs, title }: { tabs: TabNavItem[]; title: string }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const current = tabs.find((x) => x.active);
  // Navigating (picking a tab, or the back button) closes the sheet.
  const isOpen = open && openedAt === pathname;

  return (
    <>
      <nav className="hidden flex-wrap gap-2 border-b border-black/5 pb-3 sm:flex" aria-label={title}>
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.active ? "page" : undefined}
            className={tab.active ? investingTabPillActive : investingTabPillIdle}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="border-b border-black/5 pb-3 sm:hidden">
        <button
          type="button"
          onClick={() => {
            setOpenedAt(pathname);
            setOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-black/10 bg-white px-4 py-2.5 text-left shadow-[0_2px_10px_rgba(18,16,13,0.04)] active:bg-[#faf8f2]"
        >
          <span className="min-w-0">
            <span className="block text-[11px] text-[#8f8676]">{title}</span>
            <span className="block truncate text-sm font-semibold text-[#1f1c17]">{current?.label ?? t("Choose a page")}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-[#8f8676]">
            {tabs.length}
            <svg viewBox="0 0 16 16" className="h-4 w-4 text-[#1f1c17]" aria-hidden>
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </div>

      {isOpen ? (
        <BottomSheet title={title} onClose={() => setOpen(false)}>
          {(close) => (
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={tab.active ? "page" : undefined}
                    onClick={() => tab.active && close()}
                    className={`flex items-center justify-between rounded-xl px-3 py-3 text-[15px] ${
                      tab.active ? "bg-[#1f1c17] font-semibold text-[#f8f4eb]" : "text-[#1f1c17] active:bg-black/5"
                    }`}
                  >
                    {tab.label}
                    {tab.active ? <CheckIcon /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </BottomSheet>
      ) : null}
    </>
  );
}
