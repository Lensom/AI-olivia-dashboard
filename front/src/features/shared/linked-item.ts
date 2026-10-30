"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/**
 * The item a link asked to open with `?open=<id>` (global search uses it), until it's dismissed.
 * `dismiss` drops the parameter from the address, so a reload doesn't open it again.
 */
export function useLinkedItem<T extends { id: string }>(list: T[]): { linked: T | null; dismiss: () => void } {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openId = searchParams.get("open");
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Once the parameter is gone, the same item can be linked to again.
  if (!openId && dismissed) setDismissed(null);

  const linked = openId && openId !== dismissed ? (list.find((x) => x.id === openId) ?? null) : null;
  const dismiss = () => {
    if (!openId) return;
    setDismissed(openId);
    router.replace(pathname, { scroll: false });
  };
  return { linked, dismiss };
}
