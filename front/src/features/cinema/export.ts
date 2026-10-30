import type { CinemaKind, CinemaTitle } from "@/features/cinema/types";

/** Type words the importer (back/app/cinema/router.py, _KIND_WORDS) maps back to the same kind. */
const KIND_WORDS: Record<CinemaKind, string> = {
  film: "Film",
  tv: "Series",
  cartoon: "Cartoon",
  animated_series: "Animated series",
  anime: "Anime",
  show: "TV show",
};

const COLUMNS: [string, (t: CinemaTitle) => string | number | null][] = [
  ["Title", (t) => t.title],
  ["Original title", (t) => t.original_title],
  ["Type", (t) => KIND_WORDS[t.kind]],
  ["Status", (t) => t.status],
  ["Score", (t) => t.score],
  ["Recommended", (t) => (t.recommended ? "Yes" : "No")],
  ["Year", (t) => t.year],
  ["View Year", (t) => t.view_year],
  ["Season", (t) => t.watched_seasons],
  ["Genre", (t) => t.genres.join(", ")],
  ["Studio / Distributor", (t) => t.studios.join(", ")],
  ["Actors", (t) => t.actors.join(", ")],
  ["Directors", (t) => t.directors.join(", ")],
  ["IMDb rating", (t) => t.imdb_rating],
  ["IMDb", (t) => (t.imdb_id ? `https://www.imdb.com/title/${t.imdb_id}/` : "")],
  ["Notes", (t) => t.notes],
];

function cell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Downloads the titles as a CSV that opens in Excel (UTF-8 with BOM) and imports back via "Import CSV / XLSX". */
export function downloadCsv(titles: CinemaTitle[], fileName: string) {
  const lines = [COLUMNS.map(([h]) => h).join(","), ...titles.map((t) => COLUMNS.map(([, get]) => cell(get(t))).join(","))];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
