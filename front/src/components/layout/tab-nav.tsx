"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [closing, setClosing] = useState(false);
  const [openedAt, setOpenedAt] = useState(pathname);
  const closeTimer = useRef<number | null>(null);
  const current = tabs.find((x) => x.active);
  // Navigating (picking a tab, or the back button) closes the sheet.
  const isOpen = open && openedAt === pathname;

  // Slide down first, then unmount (matches .sheet-down in globals.css).
  const close = () => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 280);
  };
  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close only reads refs and setters
  }, [isOpen]);

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

      {isOpen
        ? createPortal(
            <div className="fixed inset-0 z-[60] sm:hidden" role="dialog" aria-modal="true" aria-label={title}>
              <button
                type="button"
                aria-label={t("Close")}
                onClick={close}
                className={`${closing ? "sheet-fade-out" : "sheet-fade"} absolute inset-0 bg-[#1f1c17]/35`}
              />
              <div className={`${closing ? "sheet-down" : "sheet-up"} absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-[#f8f4eb] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(18,16,13,0.18)]`}>
                <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15" aria-hidden />
                <p className="px-3 pb-2 text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{title}</p>
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
                        {tab.active ? (
                          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                            <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
