"use client";

import { useT } from "@/lib/i18n";
import { investingToolbarBtnSm } from "./investing-classes";

export function InvestingSubsectionHeader({
  title,
  isOpen,
  onToggle,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-[#1f1c17]">{t(title)}</h2>
      <button type="button" onClick={onToggle} className={investingToolbarBtnSm}>
        {isOpen ? t("Hide") : t("Show")}
      </button>
    </div>
  );
}
