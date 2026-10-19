"use client";

import { useT } from "@/lib/i18n";

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-black/5 bg-[#f6f3ea]">
      <div className="mx-auto flex w-full max-w-[1760px] flex-col gap-1.5 px-4 py-5 text-xs text-[#7f7668] sm:flex-row sm:items-center sm:justify-between md:px-5">
        <p>{t("Olivia — personal dashboard")}</p>
        <p>{t("External data sources (Sheets, Notion) planned")}</p>
      </div>
    </footer>
  );
}
