"use client";

import { LIBRARY_GROUPS, useLibraryAchievements } from "@/features/library/achievements";
import { AchievementsBoard } from "@/features/shared/achievements";
import { useT } from "@/lib/i18n";
import { useLibrary } from "@/state/library-store";

export default function LibraryAchievementsPage() {
  const t = useT();
  const { isLoaded, loadError } = useLibrary();
  const { achievements } = useLibraryAchievements();

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;
  return <AchievementsBoard achievements={achievements} groups={LIBRARY_GROUPS} />;
}
