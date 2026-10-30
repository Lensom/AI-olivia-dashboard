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
  /** Aired episodes per regular season, [0] = season 1 (TMDB). */
  season_episodes: number[];
  /** Minutes of those episodes, from their real runtimes (a long finale counts as long). */
  season_minutes: number[];
  /** ISO date of the next episode (series) or the premiere (unreleased film); "" when none is announced. */
  next_air_date: string;
  /** "S3E1"; empty for films. */
  next_episode: string;
  /** TMDB status: Returning Series, Ended, Released, In Production… */
  air_status: string;
  /** TMDB collection (franchise) a film belongs to. */
  collection_id: number | null;
  collection_name: string;
  /** ISO date of the last background refresh of the fields above. */
  tmdb_synced: string;
};

/** What POST /cinema/airing returns per title. */
export type CinemaAiring = Pick<
  CinemaTitle,
  "seasons" | "season_episodes" | "season_minutes" | "runtime" | "next_air_date" | "next_episode" | "air_status" | "collection_id" | "collection_name"
>;

export type CinemaCollection = {
  id: number;
  name: string;
  poster: string;
  parts: { tmdb_id: number; title: string; original_title: string; year: number | null; release_date: string; poster: string; animation: boolean }[];
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
  | "season_episodes"
  | "season_minutes"
  | "next_air_date"
  | "next_episode"
  | "air_status"
  | "collection_id"
  | "collection_name"
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
    season_episodes: [],
    season_minutes: [],
    next_air_date: "",
    next_episode: "",
    air_status: "",
    collection_id: null,
    collection_name: "",
    tmdb_synced: "",
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
    season_episodes: d.season_episodes?.length ? d.season_episodes : t.season_episodes,
    season_minutes: d.season_minutes?.length ? d.season_minutes : t.season_minutes,
    next_air_date: d.next_air_date ?? t.next_air_date,
    next_episode: d.next_episode ?? t.next_episode,
    air_status: d.air_status || t.air_status,
    collection_id: d.collection_id ?? t.collection_id,
    collection_name: d.collection_name || t.collection_name,
    tmdb_synced: new Date().toISOString().slice(0, 10),
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

/**
 * Minutes you've spent on a title: a watched film's runtime, or the aired minutes of the seasons of a
 * series you've watched (all of them when it's marked watched without a season). 0 when unknown.
 */
export function watchedMinutes(t: CinemaTitle): number {
  if (t.status === "planned" || t.status === "dropped") return 0;
  if (t.tmdb_media === "movie" || (!t.tmdb_media && !isSeries(t.kind))) return t.status === "watched" ? (t.runtime ?? 0) : 0;
  const minutes = t.season_minutes?.length ? t.season_minutes : (t.season_episodes ?? []).map((n) => n * (t.runtime ?? 0));
  const upTo = t.watched_seasons ?? (t.status === "watched" ? minutes.length : 0);
  return minutes.slice(0, upTo).reduce((s, n) => s + n, 0);
}

export const formatVotes = (n: number | null) =>
  n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n);

export const splitList = (s: string) =>
  s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
