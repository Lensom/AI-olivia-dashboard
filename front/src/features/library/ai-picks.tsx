"use client";

import { useEffect, useState } from "react";
import { errorText } from "@/features/cinema/title-dialog";
import { Poster, Tags } from "@/features/cinema/ui";
import { applyBookDetails, blankItem, type LibraryDetails } from "@/features/library/types";
import { Bullets, modelName, SparkIcon } from "@/features/investing/watchlist/ai-analysis";
import { apiFetch, type ApiError } from "@/lib/api";
import { useLang, useLocale, useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";
import { useLibrary } from "@/state/library-store";

type Pick = { title: string; author: string; year: number; reason: string };
type TasteResponse = {
  analysis: { headline: string; taste: string; vs_crowd: string; patterns: string[]; picks: Pick[] };
  matches: (LibraryDetails | null)[];
  model: string;
  lang: string;
  titles: number;
  created_at: string;
};

const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";
const label = "text-[11px] font-semibold uppercase tracking-wide text-[#8f8676]";

/** Overview card: Gemini reads your taste from your scores and suggests books you haven't read. */
export function LibraryAiPicks() {
  const t = useT();
  const locale = useLocale();
  const [lang] = useLang();
  const { token } = useAuth();
  const { items, update } = useLibrary();
  const [saved, setSaved] = useState<TasteResponse | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    apiFetch<TasteResponse | null>("/library/ai", { token })
      .then((d) => alive && setSaved(d))
      .catch(() => alive && setSaved(null));
    return () => {
      alive = false;
    };
  }, [token]);

  async function analyze() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      setSaved(await apiFetch<TasteResponse>(`/library/ai?lang=${lang}`, { method: "POST", token }));
    } catch (err) {
      const e = err as ApiError;
      setError(e.status === 0 ? t("Can’t reach the server") : t(errorText(err, "Something went wrong — try again.")));
    } finally {
      setBusy(false);
    }
  }

  async function addToWantToRead(p: Pick, m: LibraryDetails | null, i: number) {
    setAdding(i);
    setError(null);
    try {
      const base = { ...blankItem("book"), status: "planned" as const, finish_date: "", authors: [p.author], year: p.year };
      const item = m ? applyBookDetails(base, m, true) : { ...base, title: p.title };
      await update((list) => [item, ...list]);
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
    } finally {
      setAdding(null);
    }
  }

  const a = saved?.analysis;

  return (
    <section className={card} aria-labelledby="library-ai-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
            <SparkIcon className="h-4 w-4" />
          </span>
          <div>
            <h2 id="library-ai-title" className="text-sm font-semibold text-[#1f1c17]">
              {t("AI picks for you")}
            </h2>
            <p className="text-xs text-[#8f8676]">{t("Gemini reads your taste from your scores and suggests books you haven't read.")}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void analyze()}
          disabled={busy || saved === undefined || !token}
          className={
            a
              ? "rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] transition hover:bg-[#faf8f2] disabled:opacity-50"
              : "inline-flex items-center gap-2 rounded-full bg-[#1f1c17] px-4 py-2 text-xs font-semibold text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-50"
          }
        >
          {a ? null : <SparkIcon />}
          {busy ? t("Analyzing…") : a ? t("New picks") : t("Find what to read")}
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">
          {error}
        </p>
      ) : null}

      {busy ? (
        <div className="mt-5 space-y-2.5" role="status" aria-live="polite">
          <p className="flex items-center gap-2 text-xs text-[#6f675b]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" aria-hidden />
            {t("Reading {n} books and looking them up in the catalogues…", { n: items.length })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-black/[0.04]" />
            ))}
          </div>
        </div>
      ) : a && saved ? (
        <div className="mt-5">
          <p className="max-w-4xl text-base font-medium leading-snug text-[#1f1c17]">{a.headline}</p>
          <p className="mt-1.5 max-w-4xl text-sm leading-relaxed text-[#5f584d]">{a.taste}</p>
          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl bg-[#faf8f2] px-4 py-3">
              <p className={label}>{t("You vs other readers")}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[#3b352d]">{a.vs_crowd}</p>
            </div>
            <div className="lg:col-span-2">
              <p className={label}>{t("Patterns")}</p>
              <Bullets items={a.patterns} tone="up" />
            </div>
          </div>

          <p className={`${label} mt-5`}>{t("Read next")}</p>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {a.picks.map((p, i) => {
              const m = saved.matches[i] ?? null;
              const owned = items.some((x) => (m?.source_id && x.source_id === m.source_id) || x.title === (m?.title || p.title));
              return (
                <li key={`${p.title}-${i}`} className="flex gap-3 rounded-xl border border-black/5 p-3">
                  <Poster src={m?.cover ?? ""} title={m?.title || p.title} className="aspect-[2/3] w-16 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug text-[#1f1c17]">
                      {m?.title || p.title} <span className="font-normal text-[#8f8676]">({m?.year ?? p.year})</span>
                    </p>
                    <p className="text-[11px] text-[#8f8676]">
                      {[m?.authors[0] || p.author, m?.pages ? t("{n} pages", { n: m.pages }) : "", m?.source_rating != null ? `★ ${m.source_rating.toFixed(1)}` : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {m?.genres?.length ? <Tags items={m.genres} max={3} className="mt-1" /> : null}
                    <p className="mt-1.5 text-xs leading-snug text-[#3b352d]">{p.reason}</p>
                    {owned ? (
                      <p className="mt-2 text-[11px] font-medium text-emerald-700">✓ {t("In your library")}</p>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void addToWantToRead(p, m, i)}
                        disabled={adding !== null}
                        className="mt-2 rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] font-medium text-[#3b352d] hover:bg-[#faf8f2] disabled:opacity-50"
                      >
                        {adding === i ? t("Adding…") : `+ ${t("Want to read")}`}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-4 text-[11px] leading-snug text-[#8f8676]">
            {[
              modelName(saved.model),
              new Date(saved.created_at).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
              t("from {n} titles", { n: saved.titles }),
            ].join(" · ")}
            {" — "}
            {t("AI-generated; check before you read.")}
          </p>
        </div>
      ) : saved === undefined ? null : (
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-[#6f675b]">
          {t("Get a short read of your taste (favourite genres and authors, how you differ from other readers) and 10 books to read next, each one click to add to Want to read.")}
        </p>
      )}
    </section>
  );
}
