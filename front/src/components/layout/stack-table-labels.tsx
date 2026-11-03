"use client";

import { useEffect } from "react";

/**
 * Copies each `table.stack-table` column header into its cells' `data-label`, so on phones (where the
 * header is hidden and rows become cards, see globals.css) every value is named. Runs on every DOM
 * change, so rows added later, edit mode and language switches are labelled too. A cell that already
 * has its own data-label keeps it.
 */
export function StackTableLabels() {
  useEffect(() => {
    let frame = 0;
    const label = () => {
      frame = 0;
      document.querySelectorAll<HTMLTableElement>("table.stack-table").forEach((table) => {
        const headRow = table.tHead?.rows[table.tHead.rows.length - 1];
        if (!headRow) return;
        // Column start index → header text (colSpan aware).
        const names: string[] = [];
        for (const th of Array.from(headRow.cells)) {
          const text = (th.getAttribute("aria-label") || th.textContent || "").trim();
          for (let i = 0; i < th.colSpan; i++) names.push(text);
        }
        for (const body of [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])]) {
          for (const row of Array.from(body.rows)) {
            let col = 0;
            for (const cell of Array.from(row.cells)) {
              const own = cell.dataset.stackOwn === "1";
              if (!own) {
                if (cell.hasAttribute("data-label") && cell.dataset.stackAuto !== "1") {
                  cell.dataset.stackOwn = "1"; // set in JSX: leave it alone from now on
                } else {
                  const name = names[col] ?? "";
                  if (cell.getAttribute("data-label") !== name) cell.setAttribute("data-label", name);
                  cell.dataset.stackAuto = "1";
                }
              }
              col += cell.colSpan;
            }
          }
        }
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(label);
    };
    label();
    const observer = new MutationObserver((records) => {
      // Ignore our own attribute writes.
      if (records.every((r) => r.type === "attributes")) return;
      schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
