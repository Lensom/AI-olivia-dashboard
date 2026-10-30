"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GlobalSearch } from "@/components/layout/global-search";
import { CloseIcon, MenuIcon } from "@/components/layout/icons";
import { SidebarNav } from "@/components/layout/sidebar";
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

/** Closes a popup on Escape and on a click outside `ref`. */
function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, close, ref]);
}

/** Avatar button with the signed-in email and Logout. */
function AccountMenu({ email, onLogout }: { email: string | null; onLogout: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), ref);
  const initial = (email ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("Your account")}
        className="flex items-center gap-2 rounded-full border border-black/10 bg-white py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-[#3b352d] transition hover:bg-[#faf8f2]"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1f1c17] text-[11px] font-semibold text-[#f8f4eb]" aria-hidden>
          {initial}
        </span>
        <span className="hidden max-w-[180px] truncate lg:inline">{email}</span>
        <span aria-hidden className={`text-[10px] text-[#8f8676] transition-transform ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-[calc(100%+8px)] w-64 overflow-hidden rounded-2xl border border-black/10 bg-white shadow-[0_16px_40px_rgba(18,16,13,0.12)]">
          <div className="border-b border-black/5 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-[#8f8676]">{t("Signed in as")}</p>
            <p className="mt-0.5 truncate text-sm font-medium text-[#1f1c17]">{email ?? "…"}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="block w-full px-4 py-2.5 text-left text-sm text-rose-700 hover:bg-rose-50"
          >
            {t("Logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Below the md breakpoint the sidebar is hidden; this drawer holds the same navigation. */
function MobileNav() {
  const t = useT();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("Open menu")}
        aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-black/10 bg-white text-[#3b352d] md:hidden"
      >
        <MenuIcon className="h-4.5 w-4.5" />
      </button>
      {/* Portal: the header's backdrop blur would otherwise trap a fixed overlay inside it. */}
      {open
        ? createPortal(
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label={t("Menu")}>
              <button type="button" aria-label={t("Close menu")} onClick={() => setOpen(false)} className="absolute inset-0 bg-[#1f1c17]/30 backdrop-blur-[2px]" />
              <div className="absolute inset-y-0 left-0 flex w-[min(20rem,86vw)] flex-col bg-[#f6f3ea] shadow-2xl">
                <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
                  <span className="text-sm font-semibold text-[#1f1c17]">Olivia</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label={t("Close menu")}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-[#6f675b] hover:bg-black/5"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2.5">
                  <SidebarNav onNavigate={() => setOpen(false)} />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function Header() {
  const { token, user, status, logout } = useAuth();
  const router = useRouter();
  const t = useT();

  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-[#f6f3ea]/80 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3 px-4 py-3 md:px-5">
        <div className="flex shrink-0 items-center gap-2.5">
          {token ? <MobileNav /> : null}
          <Link href="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1f1c17] text-xs font-semibold text-[#f8f4eb]">OL</div>
            <div>
              <p className="hidden text-[10px] font-medium uppercase tracking-[0.18em] text-[#8f8676] sm:block">{t("Personal dashboard")}</p>
              <p className="text-sm font-semibold text-[#1f1c17]">Olivia</p>
            </div>
          </Link>
        </div>

        {/* Centred between the logo and the language switch; an icon button on phones. */}
        <div className="flex min-w-0 flex-1 justify-end sm:justify-center">
          <GlobalSearch />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <LangSwitch />
          {token ? (
            <AccountMenu
              email={user?.email ?? null}
              onLogout={() => {
                logout();
                router.replace("/login");
              }}
            />
          ) : status === "loading" ? null : (
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
