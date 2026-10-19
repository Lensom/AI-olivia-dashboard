"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

export default function LoginPage() {
  const router = useRouter();
  const { login, register, isLoading } = useAuth();
  const t = useT();

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("test@example.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register(email, password);
      router.push("/investing");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "message" in err) {
        setError(String((err as { message: unknown }).message));
      } else {
        setError(t("Auth failed"));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-[1.75rem] border border-black/5 bg-white/90 p-6 shadow-[0_8px_30px_rgba(18,16,13,0.05)]">
        <p className="text-xs font-medium uppercase tracking-[0.15em] text-[#8f8676]">{t("Auth")}</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#1f1c17]">
          {mode === "login" ? t("Login") : t("Create account")}
        </h1>
        <p className="mt-2 text-sm text-[#655d51]">
          {t("Local auth for development. We’ll add OAuth later.")}
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-[#6f675b]">{t("Email")}</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/20"
              placeholder="you@example.com"
              required
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-[#6f675b]">{t("Password")}</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-black/20"
              placeholder={t("min 8 characters")}
              required
            />
          </label>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || isLoading}
            className="w-full rounded-full bg-[#1f1c17] px-4 py-2 text-sm font-medium text-[#f8f4eb] transition hover:bg-[#2c2923] disabled:opacity-60"
          >
            {busy ? t("Please wait…") : mode === "login" ? t("Login") : t("Register")}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-xs text-[#6f675b]">
          <button
            type="button"
            className="rounded-full border border-black/10 bg-white px-3 py-1.5 font-medium hover:bg-[#faf8f2]"
            onClick={() => setMode((m) => (m === "login" ? "register" : "login"))}
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

