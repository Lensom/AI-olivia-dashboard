/** Mirrors back/app/places/router.py. */
export type Place = {
  id: string;
  name: string;
  location: string;
  group: string;
  visited: boolean;
  wiki: string;
  image: string;
  note: string;
};
export type PlaceCategory = { id: string; emoji: string; title: string; items: Place[] };
/** `countries`: every country you've been to (ISO alpha-2), on the list or not. */
export type Places = { categories: PlaceCategory[]; dismissed: string[]; countries: string[] };
export type Suggestion = { id: string; category: string; location: string; name: string; wiki: string; reason?: string };
export type PlacesResponse = Places & { updated_at: string | null; suggestions: Suggestion[]; ideas_from_ai: boolean; ideas_at: string | null };
export type WikiInfo = {
  image: string;
  url: string;
  description: string;
  uk_url?: string;
  uk_description?: string;
  lat?: number | null;
  lon?: number | null;
};

export type View = "cards" | "map";

export type StatusFilter = "all" | "visited" | "planned";
export type Sort = "category" | "name" | "location" | "visited" | "planned";

export const SORTS: { value: Sort; label: string }[] = [
  { value: "category", label: "By category" },
  { value: "name", label: "By name" },
  { value: "location", label: "By location" },
  { value: "visited", label: "Visited first" },
  { value: "planned", label: "Planned first" },
];

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

/** The backend refuses anything else as a picture; checking here keeps the form from sending it. */
export const isWebLink = (s: string) => /^https?:\/\/[^\s"'<>]+$/i.test(s.trim());

/** For search: case and accents don't matter. */
export const norm = (s: string) => s.toLocaleLowerCase("uk").normalize("NFKD").replace(/\p{M}/gu, "");

/** The countries in a location: "Париж, Франція" → Франція; "США / Канада" → США, Канада. */
export const countriesOf = (location: string): string[] => {
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  return last ? last.split("/").map((s) => s.trim()).filter(Boolean) : [];
};

export const emptyPlace = (): Place => ({ id: newId(), name: "", location: "", group: "", visited: false, wiki: "", image: "", note: "" });
