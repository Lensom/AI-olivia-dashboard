"use client";

import { useMemo, useState } from "react";
import { investingToolbarBtn } from "@/features/investing/ui/investing-classes";
import { parseBackupCode, ROADMAP, TRACKS, type Progress, type RoadmapTopic } from "@/features/life/career/roadmap";
import { useCareer } from "@/features/life/career/store";
import { useT } from "@/lib/i18n";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const STATE_LABEL = ["Not started", "In progress", "Done"] as const;

const today = () => new Date().toISOString().slice(0, 10);
const isNow = (tp: RoadmapTopic, day: string) => !!tp.from && !!tp.to && tp.from <= day && day <= tp.to;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs font-medium ${on ? "border-[#1f1c17] bg-[#1f1c17] text-[#f8f4eb]" : "border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]"}`}
    >
      {children}
    </button>
  );
}

export default function CareerLearningPage() {
  const t = useT();
  const { data, update } = useCareer();
  const progress = data.progress;
  const [mustOnly, setMustOnly] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [code, setCode] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [day] = useState(today);
  function save(next: Progress) {
    update(["progress"], () => ({ progress: next }));
  }

  /** One click: in progress; two: done; three: back to not started. */
  function cycle(id: string) {
    const next = { ...progress };
    const s = ((next[id] ?? 0) + 1) % 3;
    if (s) next[id] = s as 1 | 2;
    else delete next[id];
    save(next);
  }

  const totals = useMemo(() => {
    const all = ROADMAP.flatMap((tp) => tp.items);
    const done = all.filter((i) => progress[i.id] === 2).length;
    const doing = all.filter((i) => progress[i.id] === 1).length;
    const must = all.filter((i) => i.must);
    return { total: all.length, done, doing, mustDone: must.filter((i) => progress[i.id] === 2).length, must: must.length };
  }, [progress]);
  const pct = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;

  function importCode() {
    const parsed = parseBackupCode(code);
    if (!parsed) {
      setNote(t("The code wasn't recognised. Paste it whole, as “Copy progress code” gave it."));
      return;
    }
    save({ ...progress, ...parsed });
    setCode("");
    setNote(t("Progress brought over: {n} items.", { n: Object.keys(parsed).length }));
  }

  return (
    <div className="space-y-5">
        <section className={`${card} sticky top-2 z-10 space-y-3`} aria-label={t("Progress")}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-3xl font-semibold tabular-nums text-[#1f1c17]">{pct}%</p>
            <div className="min-w-[180px] flex-1">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-[#ece6da]" aria-hidden>
                <span className="block h-full bg-emerald-600" style={{ width: `${(totals.done / (totals.total || 1)) * 100}%` }} />
                <span className="block h-full bg-amber-400" style={{ width: `${(totals.doing / (totals.total || 1)) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs tabular-nums text-[#6f675b]">
                {t("Done {d} of {n} · in progress {p}", { d: totals.done, n: totals.total, p: totals.doing })} · {t("must-have {d} of {n}", { d: totals.mustDone, n: totals.must })}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={mustOnly} onClick={() => setMustOnly(!mustOnly)}>{t("Must-have only")}</Chip>
              <Chip on={hideDone} onClick={() => setHideDone(!hideDone)}>{t("Hide done")}</Chip>
            </div>
          </div>
        </section>

        {(
          <ol className="relative space-y-6 pl-9 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-0.5 before:bg-[#e3ddd1]">
            {ROADMAP.map((tp, n) => {
              const look = TRACKS[tp.track];
              const done = tp.items.filter((i) => progress[i.id] === 2).length;
              const complete = done === tp.items.length;
              const now = isNow(tp, day);
              const items = tp.items.filter((i) => (!mustOnly || i.must) && (!hideDone || progress[i.id] !== 2));
              return (
                <li key={tp.title} className="relative">
                  <span
                    className={`absolute -left-9 top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-white font-mono text-[11px] font-bold ${look.dot} ${complete ? "!bg-current" : ""}`}
                    aria-hidden
                  >
                    <span className={complete ? "text-white" : ""}>{complete ? "✓" : n}</span>
                  </span>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold text-[#1f1c17]">{tp.title}</h2>
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-wide ${look.tag}`}>{look.label}</span>
                    {now ? <span className="rounded-full bg-[#1f1c17] px-2 py-0.5 text-[11px] font-semibold text-[#f8f4eb]">{t("Now")}</span> : null}
                    <span className="text-xs text-[#8f8676]">{tp.when}</span>
                    <span className="ml-auto font-mono text-xs tabular-nums text-[#8f8676]">
                      {done}/{tp.items.length}
                    </span>
                  </div>
                  <p className="mb-2.5 mt-1 max-w-3xl text-sm text-[#6f675b]">{tp.why}</p>
                  {items.length ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {items.map((i) => {
                        const s = progress[i.id] ?? 0;
                        return (
                          <button
                            key={i.id}
                            type="button"
                            onClick={() => cycle(i.id)}
                            aria-label={`${i.name}: ${t(STATE_LABEL[s])}`}
                            className={`flex min-w-0 items-start gap-2.5 rounded-lg border-[1.5px] px-3 py-2 text-left transition ${
                              s === 2 ? "border-emerald-500 bg-emerald-50" : s === 1 ? "border-amber-400 bg-amber-50" : i.must ? `${look.must} bg-white` : "border-black/10 bg-white"
                            } hover:shadow-sm`}
                          >
                            <span
                              aria-hidden
                              className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border-[1.5px] text-xs font-bold ${
                                s === 2 ? "border-emerald-600 bg-emerald-600 text-white" : s === 1 ? "border-amber-500 text-amber-600" : "border-[#a39a89]"
                              }`}
                            >
                              {s === 2 ? "✓" : s === 1 ? "…" : ""}
                            </span>
                            <span className="min-w-0">
                              <span className={`block text-sm font-semibold leading-snug text-[#1f1c17] ${s === 2 ? "line-through decoration-emerald-600/60" : ""}`}>
                                {i.name}
                                {!i.must ? <span className="ml-1.5 font-mono text-[10px] font-medium uppercase tracking-wide text-[#8f8676]">{t("bonus")}</span> : null}
                              </span>
                              {i.hint ? <span className="mt-0.5 block text-xs leading-snug text-[#6f675b]">{i.hint}</span> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-[#8f8676]">{t("Nothing left here with these filters.")}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <details className={card}>
          <summary className="cursor-pointer text-sm font-semibold text-[#1f1c17]">{t("Bring over progress from the HTML roadmap")}</summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-[#6f675b]">
              {t("In the old page press “Copy progress code” and paste it here. Items done or in progress there are added to what's here; your progress is now saved on the server, on every device.")}
            </p>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              rows={2}
              aria-label={t("Progress code")}
              className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-black/25"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={importCode} disabled={!code.trim()} className={`${investingToolbarBtn} disabled:opacity-40`}>
                {t("Bring over")}
              </button>
              {note ? <span className="text-xs text-[#6f675b]" role="status">{note}</span> : null}
            </div>
          </div>
        </details>
    </div>
  );
}
