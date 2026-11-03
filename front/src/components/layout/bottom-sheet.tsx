"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";

/**
 * A panel that glides up from the bottom of the screen over a dimmed page (phones). Render it only
 * while open; `children` gets `close`, which plays the slide-down animation and then calls
 * `onClose`. Tapping the backdrop or pressing Escape closes it the same way.
 */
export function BottomSheet({
  title,
  onClose,
  children,
  className = "sm:hidden",
}: {
  title: string;
  onClose: () => void;
  children: (close: () => void) => ReactNode;
  /** Where it shows; by default phones only. */
  className?: string;
}) {
  const t = useT();
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Closing = slide down (matches .sheet-down in globals.css), then let the parent unmount us.
  const close = useCallback(() => setClosing(true), []);
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => onCloseRef.current(), 280);
    return () => window.clearTimeout(timer);
  }, [closing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [close]);

  return createPortal(
    <div className={`fixed inset-0 z-[60] ${className}`} role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label={t("Close")}
        onClick={close}
        className={`${closing ? "sheet-fade-out" : "sheet-fade"} absolute inset-0 bg-[#1f1c17]/35`}
      />
      <div
        className={`${closing ? "sheet-down" : "sheet-up"} absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-3xl bg-[#f8f4eb] px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_40px_rgba(18,16,13,0.18)]`}
      >
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-black/15" aria-hidden />
        <p className="truncate px-3 pb-2 text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{title}</p>
        {children(close)}
      </div>
    </div>,
    document.body,
  );
}

/** A big, thumb-friendly row inside a BottomSheet. */
export function SheetItem({
  children,
  onClick,
  active = false,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left text-[15px] disabled:opacity-40 ${
        active ? "bg-[#1f1c17] font-semibold text-[#f8f4eb]" : danger ? "text-rose-700 active:bg-rose-50" : "text-[#1f1c17] active:bg-black/5"
      }`}
    >
      {children}
    </button>
  );
}

export function CheckIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
