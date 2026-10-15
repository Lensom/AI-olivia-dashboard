"use client";

import { RequireAuth } from "@/components/auth/require-auth";
import { CryptoProvider } from "@/state/crypto-store";

/** Total needs live crypto values next to the (app-wide) stocks data. */
export default function TotalLayout({ children }: { children: React.ReactNode }) {
  return (
    <CryptoProvider>
      <RequireAuth>{children}</RequireAuth>
    </CryptoProvider>
  );
}
