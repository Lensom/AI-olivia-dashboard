"use client";

import { useT } from "@/lib/i18n";

export function Footer() {
  const t = useT();
  return (
    <footer className="border-t border-black/5">
      <div className="mx-auto w-full max-w-[1760px] px-4 py-4 text-xs text-[#8f8676] md:px-5">
        <p>{t("Olivia — personal dashboard")}</p>
      </div>
    </footer>
  );
}
