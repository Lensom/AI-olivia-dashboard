"use client";

import { createElement, useMemo } from "react";
import { LIBRARY_KINDS, libraryKindMeta } from "@/features/library/nav";
import type { LibraryItem } from "@/features/library/types";
import { Stars } from "@/features/library/ui";
import { TopsBoard, type TopDimension, type TopItem } from "@/features/shared/tops-board";
import { useLibrary } from "@/state/library-store";

const KINDS = LIBRARY_KINDS.map((k) => ({ value: k.kind, label: k.label }));

const DIMENSIONS: TopDimension[] = [
  { value: "genre", label: "Genres", min: 2 },
  { value: "author", label: "Authors", min: 2 },
  { value: "year", label: "Year read", min: 2, newestFirst: true },
  { value: "decade", label: "Published", min: 2, newestFirst: true },
  { value: "kind", label: "Kinds", min: 1 },
];

/** A book for the Tops board: ranked by your stars, then readers' rating, then ✓, then most recent. */
function libraryTopItem(t: LibraryItem): TopItem {
  const meta = libraryKindMeta(t.kind);
  return {
    id: t.id,
    title: t.title,
    altTitle: t.original_title,
    subtitle: [t.authors[0], t.finish_date.slice(0, 4) || t.year].filter(Boolean).join(" · ") || meta.label,
    cover: t.cover,
    href: `/library/${meta.slug}`,
    kind: t.kind,
    score: t.score,
    rank: [t.score ?? -1, t.source_rating ?? -1, Number(t.recommended), Number(t.finish_date.replace(/-/g, "")) || 0],
    groups: {
      genre: t.genres,
      author: t.authors,
      year: t.finish_date ? [`Read in ${t.finish_date.slice(0, 4)}`] : [],
      decade: t.year ? [`${Math.floor(t.year / 10) * 10}s`] : [],
      kind: [meta.label],
    },
    badges: createElement(Stars, { score: t.score }),
  };
}

export default function LibraryTopsPage() {
  const { items, lists, isLoaded, loadError, updateLists } = useLibrary();
  const topItems = useMemo(() => items.map(libraryTopItem), [items]);

  if (loadError) return <p className="rounded-xl bg-rose-50 px-4 py-2.5 text-sm text-rose-800">{loadError}</p>;
  if (!isLoaded) return <p className="text-sm text-[#8f8676]">Loading…</p>;

  return (
    <TopsBoard
      items={topItems}
      lists={lists}
      updateLists={updateLists}
      dimensions={DIMENSIONS}
      kinds={KINDS}
      tieBreak="ties broken by readers' rating, then the most recent"
    />
  );
}
