"use client";

import Link from "next/link";
import { useAuth } from "@/state/auth-store";

export function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-[#f6f3ea]/80 backdrop-blur-lg">
      <div className="mx-auto flex w-full max-w-[1760px] items-center justify-between gap-3 px-4 py-3 md:px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1f1c17] text-xs font-semibold text-[#f8f4eb]">
            OL
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-[#8f8676]">
              Personal dashboard
            </p>
            <p className="text-sm font-semibold text-[#1f1c17]">Olivia</p>
          </div>
        </Link>

        <div className="flex items-center gap-2">
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
              Logout
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-xs font-medium text-[#f8f4eb] transition hover:bg-[#2c2923]"
            >
              Login
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
