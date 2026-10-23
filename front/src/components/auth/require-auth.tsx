"use client";

import { ReactNode, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/state/auth-store";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, status, loggedOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();

  useEffect(() => {
    if (status === "signed-out") router.replace(loggedOut ? "/login" : `/login?next=${encodeURIComponent(pathname)}`);
  }, [status, loggedOut, router, pathname]);

  if (status === "offline") {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900" role="status">
        <p className="font-semibold">{t("Can’t reach the server")}</p>
        <p className="mt-1">{t("You’re still signed in. Retrying every few seconds…")}</p>
      </div>
    );
  }
  // With a saved token the page renders right away while the server confirms it in the background.
  if (!token) return null;
  return <>{children}</>;
}
