import { applyDetails, blankTitle, type CinemaDetails, type CinemaKind, type CinemaStatus, type CinemaTitle, type TmdbMedia } from "@/features/cinema/types";
import { apiFetch } from "@/lib/api";

/** A new library title filled from TMDB details, e.g. a recommendation added to the watchlist in one click. */
export async function titleFromTmdb(
  token: string | null,
  media: TmdbMedia,
  tmdbId: number,
  kind: CinemaKind,
  status: CinemaStatus = "planned",
): Promise<CinemaTitle> {
  const d = await apiFetch<CinemaDetails>(`/cinema/details?media=${media}&tmdb_id=${tmdbId}`, { token: token ?? undefined });
  const t = applyDetails(blankTitle(kind), d, true);
  return { ...t, status, view_year: status === "planned" ? null : t.view_year };
}
