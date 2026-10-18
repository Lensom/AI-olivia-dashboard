/** Mirrors back/app/cinema/schemas.py. */
/** `tv` is the Series page; `show` is TV shows (reality, talk, competitions). */
export type CinemaKind = "film" | "tv" | "cartoon" | "animated_series" | "anime" | "show";
export type CinemaStatus = "watched" | "watching" | "planned" | "dropped";
export type TmdbMedia = "movie" | "tv";

export type CinemaTitle = {
  id: string;
  kind: CinemaKind;
  title: string;
  original_title: string;
  recommended: boolean;
  genres: string[];
  status: CinemaStatus;
  score: number | null;
  year: number | null;
  view_year: number | null;
  studios: string[];
  actors: string[];
  directors: string[];
  poster: string;
  backdrop: string;
  overview: string;
  runtime: number | null;
  /** Total seasons released (TMDB). */
  seasons: number | null;
  /** Series: watched up to this season. */
  watched_seasons: number | null;
  tmdb_id: number | null;
  tmdb_media: TmdbMedia | "";
  tmdb_rating: number | null;
  /** Global IMDb rating, refreshed from IMDb's daily public dataset. */
  imdb_id: string;
  imdb_rating: number | null;
  imdb_votes: number | null;
  notes: string;
  added_at: string;
};

/** A ranked list you curate on the Tops page (shared with Library). */
export type { RankedList as CinemaList, RankedListEntry as CinemaListEntry } from "@/features/shared/tops-board";

export type CinemaSearchResult = {
  tmdb_id: number;
  tmdb_media: TmdbMedia;
  title: string;
  original_title: string;
  year: number | null;
  poster: string;
  overview: string;
  tmdb_rating: number | null;
  animation: boolean;
};

/** TMDB facts for one title, shaped like the CinemaTitle fields they fill. */
export type CinemaDetails = Pick<
  CinemaTitle,
  | "title"
  | "original_title"
  | "year"
  | "genres"
  | "studios"
  | "actors"
  | "directors"
  | "poster"
  | "backdrop"
  | "overview"
  | "runtime"
  | "seasons"
  | "tmdb_rating"
  | "imdb_id"
  | "imdb_rating"
  | "imdb_votes"
> & { tmdb_id: number; tmdb_media: TmdbMedia };

export const STATUSES: { value: CinemaStatus; label: string; dot: string; pill: string }[] = [
  { value: "watched", label: "Watched", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  { value: "watching", label: "Watching", dot: "bg-sky-500", pill: "bg-sky-50 text-sky-800 border-sky-200" },
  { value: "planned", label: "Plan to watch", dot: "bg-amber-500", pill: "bg-amber-50 text-amber-800 border-amber-200" },
  { value: "dropped", label: "Dropped", dot: "bg-stone-400", pill: "bg-stone-100 text-stone-600 border-stone-200" },
];

export const statusMeta = (s: CinemaStatus) => STATUSES.find((x) => x.value === s) ?? STATUSES[0];

export function newCinemaId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

export function blankTitle(kind: CinemaKind, title = ""): CinemaTitle {
  return {
    id: newCinemaId(),
    kind,
    title,
    original_title: "",
    recommended: false,
    genres: [],
    status: "watched",
    score: null,
    year: null,
    view_year: new Date().getFullYear(),
    studios: [],
    actors: [],
    directors: [],
    poster: "",
    backdrop: "",
    overview: "",
    runtime: null,
    seasons: null,
    watched_seasons: null,
    tmdb_id: null,
    tmdb_media: "",
    tmdb_rating: null,
    imdb_id: "",
    imdb_rating: null,
    imdb_votes: null,
    notes: "",
    added_at: new Date().toISOString().slice(0, 10),
  };
}

/**
 * Applies TMDB details to a title. TMDB-only fields (poster, description, rating…) are always taken;
 * your genres, actors and studios are kept unless they're empty or `replaceLists` is set.
 */
export function applyDetails(t: CinemaTitle, d: CinemaDetails, replaceLists: boolean): CinemaTitle {
  const pick = (mine: string[], theirs: string[]) => (replaceLists || mine.length === 0) && theirs.length ? theirs : mine;
  return {
    ...t,
    title: t.title.trim() || d.title,
    original_title: d.original_title || t.original_title,
    year: t.year ?? d.year,
    genres: pick(t.genres, d.genres),
    studios: pick(t.studios, d.studios),
    actors: pick(t.actors, d.actors),
    directors: d.directors.length ? d.directors : t.directors,
    poster: d.poster || t.poster,
    backdrop: d.backdrop || t.backdrop,
    overview: d.overview || t.overview,
    runtime: d.runtime ?? t.runtime,
    seasons: d.seasons ?? t.seasons,
    tmdb_id: d.tmdb_id,
    tmdb_media: d.tmdb_media,
    tmdb_rating: d.tmdb_rating ?? t.tmdb_rating,
    imdb_id: d.imdb_id || t.imdb_id,
    imdb_rating: d.imdb_rating ?? t.imdb_rating,
    imdb_votes: d.imdb_votes ?? t.imdb_votes,
  };
}

/** Same title typed twice: compares case- and punctuation-insensitively, plus the year when both have one. */
export function sameTitle(a: Pick<CinemaTitle, "title" | "year">, b: Pick<CinemaTitle, "title" | "year">): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return norm(a.title) === norm(b.title) && (a.year == null || b.year == null || a.year === b.year);
}

// Notion-like tag colours, picked by the tag's name so the same genre or actor always looks the same.
const TAG_COLORS = [
  "bg-[#f5e9d6] text-[#7a4f12]",
  "bg-[#e3eefb] text-[#1f4f8a]",
  "bg-[#f8e4ec] text-[#8a2550]",
  "bg-[#e2f3ea] text-[#1d6b45]",
  "bg-[#ece6fa] text-[#4b3596]",
  "bg-[#fbe7df] text-[#8f3a1b]",
  "bg-[#eeeeec] text-[#4a4741]",
];

export function tagColor(name: string): string {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[h % TAG_COLORS.length];
}

export const isSeries = (kind: CinemaKind) => kind !== "film" && kind !== "cartoon";

/** Released seasons you haven't watched yet (0 when caught up or unknown). */
export const newSeasons = (t: Pick<CinemaTitle, "seasons" | "watched_seasons">) =>
  t.seasons != null && t.watched_seasons != null ? Math.max(0, t.seasons - t.watched_seasons) : 0;

export const formatVotes = (n: number | null) =>
  n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

export const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
