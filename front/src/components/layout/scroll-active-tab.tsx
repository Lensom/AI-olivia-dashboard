"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * On phones, tab rows (`.scroll-row`) scroll sideways instead of wrapping. After each navigation this
 * scrolls every such row so its current tab (aria-current="page") is in view, without moving the page.
 */
export function ScrollActiveTab() {
  const pathname = usePathname();
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      document.querySelectorAll<HTMLElement>(".scroll-row").forEach((row) => {
        if (row.scrollWidth <= row.clientWidth) return;
        const active = row.querySelector<HTMLElement>('[aria-current="page"]');
        if (!active) return;
        const r = row.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        row.scrollLeft += a.left - r.left - (r.width - a.width) / 2;
      });
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);
  return null;
}
