"use client";

import { useMemo } from "react";
import { CINEMA_KINDS } from "@/features/cinema/nav";
import { CINEMA_TOP_DIMENSIONS, cinemaTopItem, notionTopsStarter } from "@/features/cinema/tops";
import { TopsBoard } from "@/features/shared/tops-board";
import { useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const KINDS = CINEMA_KINDS.map((k) => ({ value: k.kind, label: k.label }));

export default function CinemaTopsPage() {
  const { items, lists, isLoaded, loadError, updateLists } = useCinema();
  const tr = useT();
  const topItems = useMemo(() => items.map((t) => cinemaTopItem(t, tr)), [items, tr]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{tr(loadError)}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">{tr("Loading…")}</p>;

  return (
    <TopsBoard
      items={topItems}
      lists={lists}
      updateLists={updateLists}
      dimensions={CINEMA_TOP_DIMENSIONS}
      kinds={KINDS}
      starter={notionTopsStarter}
      tieBreak="ties broken by IMDb rating"
    />
  );
}
