import { createElement, Fragment } from "react";
import { cinemaKindMeta } from "@/features/cinema/nav";
import type { CinemaTitle } from "@/features/cinema/types";
import { ImdbRating, ScoreBadge } from "@/features/cinema/ui";
import type { TopDimension, TopItem } from "@/features/shared/tops-board";
import type { T } from "@/lib/i18n";

export const CINEMA_TOP_DIMENSIONS: TopDimension[] = [
  { value: "genre", label: "Genres", min: 2 },
  { value: "actor", label: "Actors", min: 3 },
  { value: "director", label: "Directors", min: 2 },
  { value: "studio", label: "Studios", min: 3 },
  { value: "decade", label: "Decades", min: 2, newestFirst: true, format: (k, t) => t("{d}s", { d: k }) },
  { value: "kind", label: "Kinds", min: 1, format: (k, t) => t(k) },
];

/** A title for the Tops board: ranked by your score, then IMDb, then ✓. */
export function cinemaTopItem(t: CinemaTitle, tr: T): TopItem {
  const meta = cinemaKindMeta(t.kind);
  return {
    id: t.id,
    title: t.title,
    altTitle: t.original_title,
    subtitle: [tr(meta.label), t.year].filter(Boolean).join(" · "),
    cover: t.poster,
    href: `/cinematography/${meta.slug}`,
    kind: t.kind,
    score: t.score,
    rank: [t.score ?? -1, t.imdb_rating ?? -1, Number(t.recommended)],
    groups: {
      genre: t.genres,
      actor: t.actors,
      director: t.directors,
      studio: t.studios,
      decade: t.year ? [String(Math.floor(t.year / 10) * 10)] : [],
      kind: [meta.label],
    },
    badges: createElement(
      Fragment,
      null,
      t.imdb_rating != null ? createElement(ImdbRating, { rating: t.imdb_rating, votes: null, imdbId: "" }) : null,
      createElement(ScoreBadge, { score: t.score }),
    ),
  };
}
