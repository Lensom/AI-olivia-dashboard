"use client";

import { GROUPS, useAchievements } from "@/features/cinema/achievements";
import { AchievementsBoard } from "@/features/shared/achievements";
import { useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

export default function CinemaAchievementsPage() {
  const t = useT();
  const { isLoaded, loadError } = useCinema();
  const { achievements } = useAchievements();

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{t(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{t("Loading…")}</p>;
  return <AchievementsBoard achievements={achievements} groups={GROUPS} />;
}
