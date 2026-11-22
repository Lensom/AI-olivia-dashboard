"use client";

import { useState } from "react";
import {
  APPLYING,
  CALL_SCRIPTS,
  DAILY,
  FORMULA,
  NOT_NOW,
  OFFER_CHECKLIST,
  OFFER_TIPS,
  REFERRAL_SCRIPTS,
  REFERRAL_TIPS,
  RULES,
  SOURCES,
  STAR,
  TECHNICAL,
  type Script,
} from "@/features/life/career/guide";
import { useCareer } from "@/features/life/career/store";
import { useT } from "@/lib/i18n";

const card = "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-[0_8px_30px_rgba(18,16,13,0.05)] sm:p-5";
const h2 = "text-base font-semibold text-[#1f1c17]";

function Copyable({ s }: { s: Script }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-black/5 bg-[#faf8f2] p-3">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-semibold uppercase tracking-wide text-[#8f8676]">{s.title}</p>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard?.writeText(s.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
          }
          className="rounded-full border border-black/10 bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#3b352d] hover:bg-[#f3efe5]"
        >
          {copied ? t("Copied") : t("Copy")}
        </button>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-[#1f1c17]">{s.text}</p>
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#3b352d]">
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}

function Story({ id, title, hint }: { id: string; title: string; hint: string }) {
  const t = useT();
  const { data, update } = useCareer();
  const saved = data.notes[id] ?? "";
  const [text, setText] = useState(saved);
  return (
    <li className="space-y-1">
      <p className="text-sm">
        <b className="text-[#1f1c17]">{title}:</b> <span className="text-[#6f675b]">{hint}</span>
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== saved) update(["notes"], (d) => ({ notes: { ...d.notes, [id]: text.trim() } }));
        }}
        maxLength={4000}
        rows={2}
        placeholder={t("Situation, task, action, result — with a number. About 2 minutes out loud.")}
        aria-label={title}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/25"
      />
    </li>
  );
}

export default function CareerGuidePage() {
  const t = useT();
  const { data, update } = useCareer();
  const toggle = (id: string) =>
    update(["checks"], (d) => {
      const checks = { ...d.checks };
      if (checks[id]) delete checks[id];
      else checks[id] = true;
      return { checks };
    });

  return (
    <div className="space-y-5">
      <section className={card}>
        <h2 className={h2}>{t("The first call with a recruiter")}</h2>
        <p className="mt-1 text-sm text-[#6f675b]">{t("Dutch business culture values directness: short answers, numbers, an honest “I don't know, here's how I'd find out”.")}</p>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {CALL_SCRIPTS.map((s) => (
            <Copyable key={s.id} s={s} />
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>{t("Referrals")}</h2>
        <List items={REFERRAL_TIPS} />
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {REFERRAL_SCRIPTS.map((s) => (
            <Copyable key={s.id} s={s} />
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className={h2}>{t("Behavioral: 5 STAR stories")}</h2>
        <p className="mt-1 text-sm text-[#6f675b]">{t("Situation, Task, Action, Result. Each story about 2 minutes, the result with a number. Write yours here; they're saved.")}</p>
        <ol className="mt-3 space-y-3">
          {STAR.map((s) => (
            <Story key={s.id} {...s} />
          ))}
        </ol>
      </section>

      <section className={card}>
        <h2 className={h2}>{t("Technical stages")}</h2>
        <dl className="mt-2 space-y-2 text-sm">
          {TECHNICAL.map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-[#1f1c17]">{k}</dt>
              <dd className="text-[#3b352d]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={card}>
        <h2 className={h2}>{t("Offer and negotiation")}</h2>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-[#8f8676]">{t("In writing")}</p>
        <ul className="mt-1 space-y-1">
          {OFFER_CHECKLIST.map((i) => (
            <li key={i.id}>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={!!data.checks[i.id]} onChange={() => toggle(i.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600" />
                <span className={data.checks[i.id] ? "text-[#8f8676] line-through" : "text-[#1f1c17]"}>{i.text}</span>
              </label>
            </li>
          ))}
        </ul>
        <List items={OFFER_TIPS} />
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className={card}>
          <h2 className={h2}>{t("How to apply")}</h2>
          <List items={APPLYING} />
        </div>
        <div className={card}>
          <h2 className={h2}>{t("What keeps repeating in successful moves")}</h2>
          <List items={FORMULA} />
        </div>
        <div className={card}>
          <h2 className={h2}>{t("Hard mode rules")}</h2>
          <List items={RULES} />
        </div>
        <div className={card}>
          <h2 className={h2}>{t("A weekday (~1.5 hours)")}</h2>
          <List items={DAILY} />
          <p className="mt-3 text-sm text-[#6f675b]">{NOT_NOW}</p>
        </div>
      </section>

      <p className="text-xs text-[#8f8676]">
        {t("Links:")}{" "}
        {SOURCES.map(([name, url], i) => (
          <span key={url}>
            {i ? " · " : ""}
            <a href={url} target="_blank" rel="noreferrer" className="underline decoration-black/20 underline-offset-2 hover:text-[#1f1c17]">
              {name}
            </a>
          </span>
        ))}
      </p>
    </div>
  );
}
