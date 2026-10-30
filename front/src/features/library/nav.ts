import type { LibraryKind } from "@/features/library/types";

/** Library pages: names and order shared by the sidebar, tabs and the backend defaults. */
export const LIBRARY_KINDS: {
  kind: LibraryKind;
  slug: string;
  label: string;
  singular: string;
  description: string;
  /** Interface text keys: "Add book", "{n} books" (translated with plurals). */
  add: string;
  count: string;
}[] = [
  { kind: "book", slug: "books", label: "Books", singular: "book", description: "Fiction and non-fiction", add: "Add book", count: "{n} books" },
  { kind: "comic", slug: "comics", label: "Comics", singular: "comic", description: "Comics and graphic novels", add: "Add comic", count: "{n} comics" },
  { kind: "manga", slug: "manga", label: "Manga", singular: "manga", description: "Manga and manhwa", add: "Add manga", count: "{n} manga" },
  { kind: "magazine", slug: "magazines", label: "Magazines", singular: "magazine", description: "Magazines and issues", add: "Add magazine", count: "{n} magazines" },
];

export const LIBRARY_EXTRA_PAGES = [
  { slug: "achievements", label: "Achievements" },
  { slug: "series", label: "Book series" },
  { slug: "tops", label: "Tops" },
];

export const libraryKindBySlug = (slug: string) => LIBRARY_KINDS.find((k) => k.slug === slug);

export const libraryKindMeta = (kind: LibraryKind) => LIBRARY_KINDS.find((k) => k.kind === kind)!;

export const libraryPageHref = (slug: string) =>
  LIBRARY_KINDS.some((k) => k.slug === slug) || LIBRARY_EXTRA_PAGES.some((p) => p.slug === slug)
    ? `/library/${slug}`
    : `/c/library/${slug}`;
