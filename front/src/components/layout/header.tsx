"use client";

import Link from "next/link";
import { useLang, useT, type Lang } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

const LANGS: { value: Lang; label: string; name: string }[] = [
  { value: "en", label: "EN", name: "English" },
  { value: "uk", label: "UA", name: "Українська" },
];

/** EN / UA switch for the interface language (your data stays as entered). */
function LangSwitch() {
  const [lang, setLang] = useLang();
  const t = useT();
  return (
    <span role="group" aria-label={t("Interface language")} className="inline-flex rounded-full border border-black/10 bg-white p-0.5">
      {LANGS.map((l) => (
        <button
          key={l.value}
          type="button"
          onClick={() => setLang(l.value)}
          aria-pressed={lang === l.value}
          title={l.name}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
            lang === l.value ? "bg-[#1f1c17] text-[#f8f4eb]" : "text-[#6f675b] hover:text-[#1f1c17]"
          }`}
        >
          {l.label}
        </button>
      ))}
    </span>
  );
}

export function Header() {
  const { user, logout } = useAuth();
  const t = useT();

  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-[#f6f3ea]/80 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3 px-4 py-3 md:px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1f1c17] text-xs font-semibold text-[#f8f4eb]">
            OL
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#8f8676]">{t("Personal dashboard")}</p>
            <p className="text-sm font-semibold text-[#1f1c17]">Olivia</p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <LangSwitch />
          {user ? (
            <span className="hidden rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-xs font-medium text-[#6f675b] md:inline">
              {user.email}
            </span>
          ) : null}

          {user ? (
            <button
              onClick={logout}
              className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
              type="button"
            >
              {t("Logout")}
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-xs font-medium text-[#f8f4eb] transition hover:bg-[#2c2923]"
            >
              {t("Login")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
