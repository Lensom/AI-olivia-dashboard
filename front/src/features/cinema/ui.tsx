"use client";

import { formatVotes, newSeasons, statusMeta, tagColor, type CinemaStatus } from "@/features/cinema/types";

export function Tags({ items, max = 99, className = "" }: { items: string[]; max?: number; className?: string }) {
  if (!items.length) return <span className="text-[#b5ad9f]">—</span>;
  const shown = items.slice(0, max);
  return (
    <span className={`flex flex-wrap gap-1 ${className}`}>
      {shown.map((t) => (
        <span key={t} className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${tagColor(t)}`}>
          {t}
        </span>
      ))}
      {items.length > shown.length ? (
        <span className="rounded px-1 py-0.5 text-[11px] text-[#8f8676]" title={items.slice(max).join(", ")}>
          +{items.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

export function StatusPill({ status }: { status: CinemaStatus }) {
  const s = statusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.pill}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Your grade: darker means higher, and the number is always shown so colour isn't the only cue. */
export function ScoreBadge({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  if (score == null) return <span className="text-[#b5ad9f]">—</span>;
  const tone =
    score >= 9 ? "bg-[#1f1c17] text-[#f8f4eb]" : score >= 7 ? "bg-[#4a443a] text-[#f8f4eb]" : score >= 5 ? "bg-[#e7e1d4] text-[#3b352d]" : "bg-[#f3efe5] text-[#8f8676]";
  const dims = size === "lg" ? "min-w-9 px-2 py-1 text-sm" : "min-w-7 px-1.5 py-0.5 text-xs";
  return (
    <span className={`inline-block rounded-md text-center font-semibold tabular-nums ${dims} ${tone}`}>
      {Number.isInteger(score) ? score : score.toFixed(1)}
    </span>
  );
}

/** Global IMDb rating with vote count; links to the title on IMDb. */
export function ImdbRating({ rating, votes, imdbId }: { rating: number | null; votes: number | null; imdbId: string }) {
  if (rating == null) return <span className="text-[#b5ad9f]">—</span>;
  const body = (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="rounded bg-[#f5c518] px-1 text-[10px] font-bold text-black">IMDb</span>
      <span className="text-sm font-semibold tabular-nums text-[#1f1c17]">{rating.toFixed(1)}</span>
      {votes ? <span className="text-[11px] tabular-nums text-[#8f8676]">{formatVotes(votes)}</span> : null}
    </span>
  );
  return imdbId ? (
    <a href={`https://www.imdb.com/title/${imdbId}/`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:opacity-80" title={`${rating} from ${votes?.toLocaleString("en-US") ?? "?"} votes — open on IMDb`}>
      {body}
    </a>
  ) : (
    body
  );
}

/** Seasons watched out of those released, e.g. "4 / 5", with a "+1 new" note when you're behind. */
export function SeasonsWatched({ watched, total }: { watched: number | null; total: number | null }) {
  if (watched == null) return <span className="text-[#b5ad9f]">{total ? `— / ${total}` : "—"}</span>;
  const behind = newSeasons({ seasons: total, watched_seasons: watched });
  return (
    <span className="whitespace-nowrap tabular-nums" title={total ? `Watched seasons 1–${watched} of ${total}` : `Watched seasons 1–${watched}`}>
      <span className="font-semibold text-[#1f1c17]">{watched}</span>
      {total ? <span className="text-[#8f8676]"> / {total}</span> : null}
      {behind ? <span className="ml-1.5 rounded bg-sky-50 px-1 text-[10px] font-medium text-sky-800">+{behind} new</span> : null}
    </span>
  );
}

export function Poster({ src, title, className = "" }: { src: string; title: string; className?: string }) {
  if (!src) {
    return (
      <span
        aria-hidden
        className={`flex items-center justify-center rounded-md bg-gradient-to-br from-[#efe9dc] to-[#e2dac8] text-[10px] font-semibold uppercase text-[#a39a89] ${className}`}
      >
        {title.trim().slice(0, 2)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- TMDB posters; no image optimisation needed for thumbnails
  return <img src={src} alt="" loading="lazy" className={`rounded-md bg-[#efe9dc] object-cover ${className}`} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-xl"} rounded-2xl border border-black/5 bg-white p-5 shadow-[0_20px_60px_rgba(18,16,13,0.18)]`}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-[#1f1c17]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full px-2 text-lg leading-none text-[#8f8676] hover:text-[#1f1c17]">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const fieldInput =
  "mt-1 w-full rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm text-[#2f2922] outline-none focus:border-black/25";
export const fieldLabel = "block text-[11px] font-medium text-[#6f675b]";
