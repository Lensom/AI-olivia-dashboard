"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUsd, parseUsd } from "@/features/investing/format";
import { feeBreakdown, xirrFromRefills } from "@/features/investing/funding-stats";
import {
  investingPageStack,
  investingPrimarySaveActive,
  investingPrimarySaveDisabled,
} from "@/features/investing/ui/investing-classes";
import { useLocale, useT } from "@/lib/i18n";
import { useBroker } from "@/state/broker-store";
import { useInvesting } from "@/state/investing-store";

const AUTOSAVE_MS = 1500;
const card = "rounded-2xl border border-black/5 bg-white/90 p-5 shadow-[0_8px_30px_rgba(18,16,13,0.05)]";

/** **bold** inside a line; everything else stays plain text (no HTML injection). */
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-[#1f1c17]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Minimal Markdown-ish preview: # headings, "* "/"- " bullets, "1. " lists, lines ending in ":" or "?" as section titles. */
function NotesPreview({ text }: { text: string }) {
  const t = useT();
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag
        key={`l${blocks.length}`}
        className={`${list.ordered ? "list-decimal" : "list-disc"} space-y-1 pl-5 marker:text-[#b0a79a]`}
      >
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[*-]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,3}\s+(.*)$/);
    if (heading || /[:?]$/.test(line.trim())) {
      blocks.push(
        <h3 key={`h${blocks.length}`} className="pt-2 text-sm font-semibold text-[#1f1c17]">
          {inline(heading ? heading[1]! : line.trim())}
        </h3>,
      );
    } else {
      blocks.push(<p key={`p${blocks.length}`}>{inline(line)}</p>);
    }
  }
  flush();
  return blocks.length ? (
    <div className="space-y-2 text-sm leading-6 text-[#2f2922]">{blocks}</div>
  ) : (
    <p className="text-sm text-[#8f8676]">{t("Nothing to preview yet.")}</p>
  );
}

function Fact({ label, value, hint, href }: { label: string; value: string; hint?: string; href: string }) {
  const t = useT();
  return (
    <Link href={href} className="block rounded-xl bg-[#faf8f2] px-3 py-2.5 transition hover:bg-[#f4efe4]">
      <p className="text-[11px] text-[#8f8676]">{t(label)}</p>
      <p className="text-base font-semibold tabular-nums text-[#1f1c17]">{value}</p>
      {hint ? <p className="text-[11px] text-[#8f8676]">{t(hint)}</p> : null}
    </Link>
  );
}

export default function InvestingNotesPage() {
  const {
    notes,
    notesMeta,
    isNotesLoading,
    isNotesDirty,
    isNotesSaving,
    setNotes,
    saveNotes,
    holdings,
    refills,
    operatingExpensesUsd,
    activitiesSummary,
  } = useInvesting();
  const { cashUsd } = useBroker();
  const tr = useT();
  const locale = useLocale();
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saveError, setSaveError] = useState(false);

  // Always call the latest saveNotes (it closes over the current text) from timers and key handlers.
  const saveRef = useRef(saveNotes);
  useEffect(() => {
    saveRef.current = saveNotes;
  }, [saveNotes]);

  const save = useMemo(
    () => () => {
      setSaveError(false);
      void saveRef.current().catch(() => setSaveError(true));
    },
    [],
  );

  // Autosave after typing pauses.
  useEffect(() => {
    if (!isNotesDirty || isNotesSaving || isNotesLoading) return;
    const t = window.setTimeout(save, AUTOSAVE_MS);
    return () => window.clearTimeout(t);
  }, [notes, isNotesDirty, isNotesSaving, isNotesLoading, save]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  useEffect(() => {
    if (!isNotesDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isNotesDirty]);

  // Live numbers to check written rules against.
  const facts = useMemo(() => {
    const holdingsValue = holdings.reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const value = holdingsValue + cashUsd; // account value: positions + broker cash
    const etfValue = holdings
      .filter((h) => (h.industry ?? "").trim().toUpperCase().startsWith("ETF"))
      .reduce((a, h) => a + parseUsd(h.marketValue), 0);
    const topped = refills.reduce((a, r) => a + parseUsd(r.amount), 0);
    const fees = feeBreakdown(refills, activitiesSummary, operatingExpensesUsd).total;
    const largest = [...holdings].sort((a, b) => parseUsd(b.marketValue) - parseUsd(a.marketValue))[0];
    return {
      value,
      etfPct: holdingsValue > 0 ? (etfValue / holdingsValue) * 100 : 0,
      feesPct: topped > 0 ? (fees / topped) * 100 : null,
      xirr: xirrFromRefills(refills, value),
      largest: largest && holdingsValue > 0 ? { ticker: largest.ticker, pct: (parseUsd(largest.marketValue) / holdingsValue) * 100 } : null,
    };
  }, [holdings, refills, operatingExpensesUsd, activitiesSummary, cashUsd]);

  const words = notes.trim() ? notes.trim().split(/\s+/).length : 0;
  const status = saveError
    ? { text: tr("Couldn’t save — check connection"), cls: "text-rose-700" }
    : isNotesSaving
      ? { text: tr("Saving…"), cls: "text-[#8f8676]" }
      : isNotesDirty
        ? { text: tr("Unsaved changes"), cls: "text-amber-700" }
        : notesMeta.updatedAt
          ? { text: tr("Saved {when}", { when: new Date(notesMeta.updatedAt).toLocaleString(locale) }), cls: "text-[#8f8676]" }
          : { text: tr("Not saved yet"), cls: "text-[#8f8676]" };

  return (
    <div className={investingPageStack}>
      <p className="text-sm text-[#655d51]">
        {tr("Your investing rules and plans. Changes save automatically; the panel on the right shows your current numbers to check the rules against.")}
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px] [&>*]:min-w-0">
        <article className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex rounded-full border border-black/10 bg-white p-1">
              {(["write", "preview"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={[
                    "rounded-full px-3 py-1.5 text-xs font-medium capitalize transition",
                    mode === m ? "bg-[#f3efe5] text-[#1f1c17]" : "text-[#6f675b] hover:bg-[#faf8f2]",
                  ].join(" ")}
                >
                  {m === "write" ? tr("Write") : tr("Preview")}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs ${status.cls}`} role="status" aria-live="polite">
                {status.text}
              </span>
              <button
                type="button"
                onClick={save}
                disabled={!isNotesDirty || isNotesSaving || isNotesLoading}
                title="Ctrl/⌘ + S"
                className={[
                  "transition",
                  !isNotesDirty || isNotesSaving || isNotesLoading
                    ? investingPrimarySaveDisabled
                    : investingPrimarySaveActive,
                ].join(" ")}
              >
                {tr("Save now")}
              </button>
            </div>
          </div>

          {mode === "write" ? (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={tr("Write your investing rules…\n\n* Bullets start with * or -\nSection titles end with :")}
              aria-label={tr("Investing notes")}
              className="min-h-[420px] w-full resize-y rounded-xl border border-black/10 bg-[#faf8f2] p-4 font-mono text-[13px] leading-6 text-[#2f2922] outline-none focus:border-black/20"
            />
          ) : (
            <div className="min-h-[420px] rounded-xl border border-black/5 bg-[#faf8f2] p-5">
              <NotesPreview text={notes} />
            </div>
          )}

          <p className="mt-2 text-[11px] text-[#8f8676]">
            {tr("{n} words", { n: words })} · {tr("Use * or - for bullets, # for headings, **bold** for emphasis. Ctrl/⌘ + S saves immediately.")}
          </p>
        </article>

        <aside className={`${card} h-fit space-y-2`}>
          <h2 className="text-sm font-semibold text-[#1f1c17]">{tr("Your numbers")}</h2>
          <p className="pb-1 text-[11px] text-[#8f8676]">{tr("Live values to check your rules against. Click to open.")}</p>
          <Fact label="Account value" value={formatUsd(facts.value)} hint={cashUsd > 0 ? tr("incl. {v} broker cash", { v: formatUsd(cashUsd) }) : undefined} href="/investing/holdings" />
          <Fact
            label="ETF share"
            value={`${facts.etfPct.toFixed(1)}%`}
            hint="Holdings whose industry starts with “ETF”"
            href="/investing/holdings"
          />
          <Fact
            label="Fees, % of deposits"
            value={facts.feesPct == null ? "—" : `${facts.feesPct.toFixed(2)}%`}
            hint="Refill + buy + sell fees / total topped"
            href="/investing/finance"
          />
          <Fact
            label="Annualized return (XIRR)"
            value={facts.xirr == null ? "—" : `${facts.xirr > 0 ? "+" : ""}${(facts.xirr * 100).toFixed(2)}%`}
            hint="Money-weighted, since first deposit"
            href="/investing/finance"
          />
          <Fact
            label="Largest position"
            value={facts.largest ? `${facts.largest.pct.toFixed(1)}%` : "—"}
            hint={facts.largest?.ticker}
            href="/investing/dashboard"
          />
        </aside>
      </div>
    </div>
  );
}
