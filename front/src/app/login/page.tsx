"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { safeNextPath, useAuth } from "@/state/auth-store";

const subscribeNothing = () => () => {};

/** `?next=` without useSearchParams (which would need a Suspense boundary for this static page). */
function useNextParam(): string | null {
  const search = useSyncExternalStore(subscribeNothing, () => window.location.search, () => "");
  return new URLSearchParams(search).get("next");
}

function authErrorKey(err: unknown, mode: "login" | "register"): string {
  const status = err && typeof err === "object" && "status" in err ? (err as ApiError).status : -1;
  if (status === 0) return "Can’t reach the server. Is the backend running?";
  if (status === 401) return "Wrong email or password.";
  if (status === 409) return "This email is already registered — log in instead.";
  if (status === 422) return mode === "register" ? "Enter a valid email and a password of at least 8 characters." : "Enter a valid email and password.";
  return "Something went wrong — try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const { login, register, status, sessionExpired } = useAuth();
  const t = useT();
  const next = safeNextPath(useNextParam());

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just signed in): go where the user was heading.
  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password);
      router.replace(next);
    } catch (err: unknown) {
      setError(t(authErrorKey(err, mode)));
      setBusy(false);
    }
  }

  const input =
    "mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/30 focus:ring-2 focus:ring-black/5";

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-[1.75rem] border border-black/5 bg-white/90 p-6 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">Olivia</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#1f1c17]">{mode === "login" ? t("Log in") : t("Create account")}</h1>

        {sessionExpired && mode === "login" ? (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
            {t("Your session has expired. Log in again to continue.")}
          </p>
        ) : null}

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-[#6f675b]">{t("Email")}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              name="email"
              autoComplete="username"
              autoFocus
              className={input}
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="block">
            <span className="flex items-baseline justify-between text-xs font-medium text-[#6f675b]">
              {t("Password")}
              <button type="button" onClick={() => setShowPassword((v) => !v)} className="font-medium text-[#2a78d6] hover:underline">
                {showPassword ? t("Hide") : t("Show")}
              </button>
            </span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "register" ? 8 : undefined}
              className={input}
              placeholder={mode === "register" ? t("min 8 characters") : ""}
              required
            />
          </label>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-full bg-[#1f1c17] px-4 py-2 text-sm font-medium text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-60"
          >
            {busy ? t("Please wait…") : mode === "login" ? t("Log in") : t("Create account")}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-xs text-[#6f675b]">
          <button
            type="button"
            className="rounded-full border border-black/10 bg-white px-3 py-1.5 font-medium hover:bg-[#faf8f2]"
            onClick={() => {
              setMode((m) => (m === "login" ? "register" : "login"));
              setError(null);
            }}
          >
            {mode === "login" ? t("Need an account?") : t("Have an account?")}
          </button>
          <Link href="/" className="font-medium text-[#3b352d]">
            {t("Back home")}
          </Link>
        </div>
      </div>
    </div>
  );
}
