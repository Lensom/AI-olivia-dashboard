"use client";

import { readStatusMeta, type LibraryStatus } from "@/features/library/types";
import { useLocale, useT } from "@/lib/i18n";

/** Your 1–5 star grade. The count is in the label, so it's not shape-only. */
export function Stars({ score, size = "sm" }: { score: number | null; size?: "sm" | "lg" }) {
  const t = useT();
  if (score == null) return <span className="text-[#b5ad9f]">—</span>;
  const full = Math.round(score);
  return (
    <span className={`inline-flex whitespace-nowrap ${size === "lg" ? "text-lg" : "text-sm"} leading-none`} aria-label={t("{v} out of 5", { v: score })} title={`${score} / 5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} aria-hidden className={i < full ? "text-[#eda100]" : "text-[#e2dccf]"}>
          ★
        </span>
      ))}
    </span>
  );
}

export function ReadStatusPill({ status }: { status: LibraryStatus }) {
  const t = useT();
  const s = readStatusMeta(status);
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.pill}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {t(s.label)}
    </span>
  );
}

/** Readers' average from the catalogue (Open Library / Google Books), out of 5. */
export function ReadersRating({ rating, votes }: { rating: number | null; votes: number | null }) {
  const t = useT();
  const locale = useLocale();
  if (rating == null) return <span className="text-[#b5ad9f]">—</span>;
  return (
    <span className="whitespace-nowrap text-xs tabular-nums text-[#3b352d]" title={votes ? t("Readers’ average from {n} ratings", { n: votes }).replace(String(votes), votes.toLocaleString(locale)) : t("Readers’ average")}>
      ★ {rating.toFixed(1)}
      {votes ? <span className="text-[#8f8676]"> · {votes >= 1000 ? `${Math.round(votes / 1000)}K` : votes}</span> : null}
    </span>
  );
}
