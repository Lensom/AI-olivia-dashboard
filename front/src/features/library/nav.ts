import type { LibraryKind } from "@/features/library/types";

/** Library pages: names and order shared by the sidebar, tabs and the backend defaults. */
export const LIBRARY_KINDS: { kind: LibraryKind; slug: string; label: string; singular: string; description: string }[] = [
  { kind: "book", slug: "books", label: "Books", singular: "book", description: "Fiction and non-fiction" },
  { kind: "comic", slug: "comics", label: "Comics", singular: "comic", description: "Comics and graphic novels" },
  { kind: "manga", slug: "manga", label: "Manga", singular: "manga", description: "Manga and manhwa" },
  { kind: "magazine", slug: "magazines", label: "Magazines", singular: "magazine", description: "Magazines and issues" },
];

export const LIBRARY_EXTRA_PAGES = [{ slug: "tops", label: "Tops" }];

export const libraryKindBySlug = (slug: string) => LIBRARY_KINDS.find((k) => k.slug === slug);

export const libraryKindMeta = (kind: LibraryKind) => LIBRARY_KINDS.find((k) => k.kind === kind)!;

export const libraryPageHref = (slug: string) =>
  LIBRARY_KINDS.some((k) => k.slug === slug) || LIBRARY_EXTRA_PAGES.some((p) => p.slug === slug)
    ? `/library/${slug}`
    : `/c/library/${slug}`;
