"use client";

import { useState } from "react";
import { errorText } from "@/features/cinema/title-dialog";
import { Poster } from "@/features/cinema/ui";
import { investingPrimarySaveActive, investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { useT } from "@/lib/i18n";
import { useCinema } from "@/state/cinema-store";

/**
 * "How was it?" right after you mark something watched without a score: a score in one tap and, if you like, a
 * sentence of what you thought. A score given later is a guess; this is when you still remember.
 */
export function RatePrompt() {
  const { items, toRate } = useCinema();
  // Anything queued that got a score some other way, or was deleted, isn't asked about.
  const pending = toRate.filter((id) => items.some((t) => t.id === id && t.score == null));
  if (!pending.length) return null;
  return <Card key={pending[0]} id={pending[0]} more={pending.length - 1} />;
}

function Card({ id, more }: { id: string; more: number }) {
  const t = useT();
  const { items, update, dismissRate } = useCinema();
  const title = items.find((x) => x.id === id)!;
  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (score == null) return;
    setBusy(true);
    setError(null);
    try {
      const said = note.trim();
      await update((list) =>
        list.map((x) => (x.id !== id ? x : { ...x, score, notes: said ? (x.notes.trim() ? `${x.notes.trim()}\n${said}` : said) : x.notes })),
      );
      dismissRate(id);
    } catch (e) {
      setError(t(errorText(e, "Could not save.")));
      setBusy(false);
    }
  }

  return (
    <section
      role="dialog"
      aria-labelledby="rate-prompt-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") dismissRate(id);
      }}
      className="fixed inset-x-3 bottom-3 z-40 rounded-2xl border border-black/10 bg-white p-4 shadow-[0_18px_60px_rgba(18,16,13,0.18)] sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[440px]"
    >
      <div className="flex gap-3">
        <Poster src={title.poster} title={title.title} className="aspect-[2/3] w-14 shrink-0 text-sm" />
        <div className="min-w-0 flex-1">
          <p id="rate-prompt-title" className="text-sm font-semibold text-[#1f1c17]">
            {t("How was “{title}”?", { title: title.title })}
          </p>
          <p className="text-xs text-[#6f675b]">{t("Your score now, while you remember it.")}</p>
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label={t("Your score")}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScore(score === n ? null : n)}
                aria-pressed={score === n}
                className={`h-7 w-7 rounded-md text-xs font-semibold tabular-nums transition ${
                  score != null && n <= score ? "bg-[#1f1c17] text-[#f8f4eb]" : "border border-black/10 bg-white text-[#6f675b] hover:bg-[#faf8f2]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        maxLength={280}
        placeholder={t("One sentence on what you thought (optional)")}
        aria-label={t("What you thought")}
        className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:border-black/25"
      />
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={score == null || busy} className={`${investingPrimarySaveActive} disabled:opacity-40`}>
          {busy ? t("Saving…") : t("Save")}
        </button>
        <button type="button" onClick={() => dismissRate(id)} className={investingToolbarBtn}>
          {t("Not now")}
        </button>
        {more > 0 ? <span className="ml-auto text-[11px] text-[#8f8676]">{t("{n} more to rate", { n: more })}</span> : null}
      </div>
    </section>
  );
}
