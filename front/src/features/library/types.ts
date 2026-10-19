/** Mirrors back/app/library/schemas.py. */
export type LibraryKind = "book" | "comic" | "manga" | "magazine";
export type LibraryStatus = "read" | "reading" | "planned" | "dropped";
export type LibrarySource = "openlibrary" | "google";

export type LibraryItem = {
  id: string;
  kind: LibraryKind;
  title: string;
  original_title: string;
  recommended: boolean;
  genres: string[];
  status: LibraryStatus;
  /** 1–5 stars. */
  score: number | null;
  authors: string[];
  /** ISO date you finished it. */
  finish_date: string;
  year: number | null;
  pages: number | null;
  publisher: string;
  cover: string;
  description: string;
  isbn: string;
  /** Comics / manga: read up to this volume. */
  volumes_read: number | null;
  volumes_total: number | null;
  source: LibrarySource | "";
  source_id: string;
  /** Readers' average on the catalogue, out of 5. */
  source_rating: number | null;
  source_votes: number | null;
  notes: string;
  added_at: string;
};

export type LibraryDetails = Pick<
  LibraryItem,
  "title" | "original_title" | "authors" | "year" | "pages" | "publisher" | "genres" | "cover" | "description" | "isbn" | "source_rating" | "source_votes"
> & { source: LibrarySource; source_id: string; language: string };

export const READ_STATUSES: { value: LibraryStatus; label: string; dot: string; pill: string }[] = [
  { value: "read", label: "Read", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  { value: "reading", label: "Reading", dot: "bg-sky-500", pill: "bg-sky-50 text-sky-800 border-sky-200" },
  { value: "planned", label: "Want to read", dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800 border-amber-200" },
  { value: "dropped", label: "Dropped", dot: "bg-stone-400", pill: "bg-stone-100 text-stone-600 border-stone-200" },
];

export const readStatusMeta = (s: LibraryStatus) => READ_STATUSES.find((x) => x.value === s) ?? READ_STATUSES[0];

/** Comics and manga are read volume by volume. */
export const hasVolumes = (kind: LibraryKind) => kind === "comic" || kind === "manga";

export function blankItem(kind: LibraryKind, title = ""): LibraryItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}`,
    kind,
    title,
    original_title: "",
    recommended: false,
    genres: [],
    status: "read",
    score: null,
    authors: [],
    finish_date: new Date().toISOString().slice(0, 10),
    year: null,
    pages: null,
    publisher: "",
    cover: "",
    description: "",
    isbn: "",
    volumes_read: null,
    volumes_total: null,
    source: "",
    source_id: "",
    source_rating: null,
    source_votes: null,
    notes: "",
    added_at: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Applies catalogue details. Cover, description, pages, year and rating are always taken; your title,
 * authors and genres are kept unless empty or `replaceLists` is set (catalogues are often in English).
 */
export function applyBookDetails(t: LibraryItem, d: LibraryDetails, replaceLists: boolean): LibraryItem {
  const pick = (mine: string[], theirs: string[]) => ((replaceLists || mine.length === 0) && theirs.length ? theirs : mine);
  return {
    ...t,
    title: t.title.trim() || d.title,
    original_title: d.title && d.title !== t.title ? d.title : t.original_title,
    authors: pick(t.authors, d.authors),
    genres: pick(t.genres, d.genres),
    year: d.year ?? t.year,
    pages: d.pages ?? t.pages,
    publisher: d.publisher || t.publisher,
    cover: d.cover || t.cover,
    description: d.description || t.description,
    isbn: d.isbn || t.isbn,
    source: d.source,
    source_id: d.source_id,
    source_rating: d.source_rating ?? t.source_rating,
    source_votes: d.source_votes ?? t.source_votes,
  };
}

export const formatDate = (iso: string, locale = "en-US") => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};
