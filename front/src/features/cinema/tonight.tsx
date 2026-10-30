"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CINEMA_KINDS, cinemaKindMeta } from "@/features/cinema/nav";
import { errorText } from "@/features/cinema/title-dialog";
import { isSeries, type CinemaKind, type CinemaTitle } from "@/features/cinema/types";
import { ImdbRating, Poster, Tags } from "@/features/cinema/ui";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

/** Max minutes for a film (series are judged by one episode). */
const TIMES = [
  { value: 0, label: "Any length" },
  { value: 100, label: "Up to 1 h 40" },
  { value: 130, label: "Up to 2 h 10" },
  { value: 160, label: "Up to 2 h 40" },
];

const select = "rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[#3b352d]";

/** Better-rated and recommended titles come up more often, but anything in the pool can. */
function weight(t: CinemaTitle): number {
  return Math.max(1, (t.imdb_rating ?? 6.5) - 4) ** 2 * (t.recommended ? 1.5 : 1);
}

function pickOne(pool: CinemaTitle[], skip: string | null): CinemaTitle | null {
  const options = pool.length > 1 ? pool.filter((t) => t.id !== skip) : pool;
  const total = options.reduce((s, t) => s + weight(t), 0);
  let r = Math.random() * total;
  for (const t of options) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return options[0] ?? null;
}

/** "What to watch tonight": a weighted random pick from your watchlist and the series you're in the middle of. */
export function TonightPicker() {
  const t = useT();
  const { items, update } = useCinema();
  const [kind, setKind] = useState<CinemaKind | "all">("all");
  const [maxMinutes, setMaxMinutes] = useState(0);
  const [genre, setGenre] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(() => items.filter((x) => x.status === "planned" || (x.status === "watching" && isSeries(x.kind))), [items]);
  const kinds = CINEMA_KINDS.filter((k) => candidates.some((x) => x.kind === k.kind));
  const genres = useMemo(() => [...new Set(candidates.flatMap((x) => x.genres))].sort((a, b) => a.localeCompare(b)), [candidates]);

  const pool = useMemo(
    () =>
      candidates.filter(
        (x) =>
          (kind === "all" || x.kind === kind) &&
          (!genre || x.genres.includes(genre)) &&
          (!maxMinutes || isSeries(x.kind) || (x.runtime != null && x.runtime <= maxMinutes)),
      ),
    [candidates, kind, genre, maxMinutes],
  );

  const picked = items.find((x) => x.id === pickedId) ?? null;

  async function start(x: CinemaTitle) {
    setError(null);
    try {
      await update((list) =>
        list.map((y) =>
          y.id !== x.id
            ? y
            : isSeries(y.kind)
              ? { ...y, status: "watching", view_year: y.view_year ?? new Date().getFullYear() }
              : { ...y, status: "watched", view_year: new Date().getFullYear() },
        ),
      );
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
    }
  }

  if (!candidates.length) return null;

  return (
    <section className={card} aria-labelledby="tonight-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="tonight-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("What to watch tonight")}
          </h2>
          <p className="text-xs text-[#6f675b]">{t("A pick from your watchlist and the series you're watching; higher-rated titles come up more often.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value as CinemaKind | "all")} className={select} aria-label={t("Type")}>
            <option value="all">{t("Any type")}</option>
            {kinds.map((k) => (
              <option key={k.kind} value={k.kind}>
                {t(k.label)}
              </option>
            ))}
          </select>
          <select value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))} className={select} aria-label={t("How much time")}>
            {TIMES.map((x) => (
              <option key={x.value} value={x.value}>
                {t(x.label)}
              </option>
            ))}
          </select>
          {genres.length ? (
            <select value={genre} onChange={(e) => setGenre(e.target.value)} className={select} aria-label={t("Genre")}>
              <option value="">{t("All genres")}</option>
              {genres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" onClick={() => setPickedId(pickOne(pool, pickedId)?.id ?? null)} disabled={!pool.length} className={investingPrimarySaveActive}>
            {picked ? t("Another one") : t("Pick for me")}
          </button>
        </div>
      </div>

      {!pool.length ? (
        <p className="mt-3 text-xs text-[#8f8676]">{t("Nothing on your list fits these filters.")}</p>
      ) : picked ? (
        <div className="mt-4 flex gap-4">
          <Poster src={picked.poster} title={picked.title} className="aspect-[2/3] w-24 shrink-0 text-xl sm:w-28" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-[#1f1c17]">
              {picked.title} {picked.year ? <span className="font-normal text-[#8f8676]">({picked.year})</span> : null}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#6f675b]">
              <span>{t(cinemaKindMeta(picked.kind).label)}</span>
              {picked.runtime ? <span>· {isSeries(picked.kind) ? t("{n} min per episode", { n: picked.runtime }) : t("{n} min", { n: picked.runtime })}</span> : null}
              {picked.status === "watching" && picked.watched_seasons ? <span>· {t("on season {n}", { n: picked.watched_seasons })}</span> : null}
              {picked.imdb_rating != null ? (
                <span>
                  · <ImdbRating rating={picked.imdb_rating} votes={picked.imdb_votes} imdbId={picked.imdb_id} />
                </span>
              ) : null}
            </p>
            <div className="mt-1.5">
              <Tags items={picked.genres} max={4} />
            </div>
            {picked.overview ? <p className="mt-2 line-clamp-3 max-w-3xl text-xs leading-relaxed text-[#3b352d]">{picked.overview}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {picked.status === "planned" ? (
                <button type="button" onClick={() => void start(picked)} className={investingToolbarBtn}>
                  {isSeries(picked.kind) ? t("Start watching") : t("Mark as watched")}
                </button>
              ) : null}
              <Link href={`/cinematography/${cinemaKindMeta(picked.kind).slug}`} className={investingToolbarBtn}>
                {t("Open {page}", { page: t(cinemaKindMeta(picked.kind).label) })}
              </Link>
            </div>
            {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-[#8f8676]">{t("{n} titles to choose from.", { n: pool.length })}</p>
      )}
    </section>
  );
}
