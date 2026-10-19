import type { CinemaKind } from "@/features/cinema/types";

/** Cinematography pages: names and order shared by the sidebar, tabs and the backend defaults. */
export const CINEMA_KINDS: {
  kind: CinemaKind;
  slug: string;
  label: string;
  singular: string;
  description: string;
  /** Interface text keys: "Add film", "{n} films" (translated with plurals). */
  add: string;
  count: string;
}[] = [
  { kind: "film", slug: "films", label: "Films", singular: "film", description: "Feature films", add: "Add film", count: "{n} films" },
  { kind: "tv", slug: "series", label: "Series", singular: "series", description: "Series and miniseries", add: "Add series", count: "{n} series" },
  { kind: "cartoon", slug: "cartoons", label: "Cartoons", singular: "cartoon", description: "Animated films", add: "Add cartoon", count: "{n} cartoons" },
  {
    kind: "animated_series",
    slug: "animated-series",
    label: "Animated series",
    singular: "series",
    description: "Animated shows",
    add: "Add animated series",
    count: "{n} animated series",
  },
  { kind: "anime", slug: "anime", label: "Anime", singular: "anime", description: "Japanese animation", add: "Add anime", count: "{n} anime" },
  {
    kind: "show",
    slug: "tv-shows",
    label: "TV shows",
    singular: "TV show",
    description: "Reality, talk and game shows",
    add: "Add TV show",
    count: "{n} TV shows",
  },
];

export const cinemaKindBySlug = (slug: string) => CINEMA_KINDS.find((k) => k.slug === slug);

export const cinemaKindMeta = (kind: CinemaKind) => CINEMA_KINDS.find((k) => k.kind === kind)!;

/** Pages that aren't a kind of title. */
export const CINEMA_EXTRA_PAGES = [{ slug: "tops", label: "Tops" }];

export const isBuiltInCinemaPage = (slug: string) =>
  CINEMA_KINDS.some((k) => k.slug === slug) || CINEMA_EXTRA_PAGES.some((p) => p.slug === slug);

export const cinemaPageHref = (slug: string) =>
  isBuiltInCinemaPage(slug) ? `/cinematography/${slug}` : `/c/cinematography/${slug}`;
