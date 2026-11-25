"use client";

import { useEffect, useState } from "react";
import { VERSION_CONFLICT_EVENT } from "@/lib/api";
import { useT } from "@/lib/i18n";

/**
 * Shown when a save was refused because another tab or device saved a newer version (back/app/versioning.py).
 * Pages show their own "could not save" note; this one says why and how to get the latest.
 */
export function VersionConflictBanner() {
  const t = useT();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const show = () => setShown(true);
    window.addEventListener(VERSION_CONFLICT_EVENT, show);
    return () => window.removeEventListener(VERSION_CONFLICT_EVENT, show);
  }, []);

  if (!shown) return null;
  return (
    <div
      role="alert"
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-2xl bg-[#1f1c17] px-4 py-3 text-sm text-[#f8f4eb] shadow-[0_12px_40px_rgba(18,16,13,0.3)]"
    >
      <p className="min-w-0 flex-1 basis-56">
        {t("This was changed in another tab or on another device, so your last change wasn't saved. Reload to get the latest version.")}
      </p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => setShown(false)} className="rounded-full px-3 py-1.5 text-xs font-medium text-[#f8f4eb]/70 hover:text-[#f8f4eb]">
          {t("Dismiss")}
        </button>
        <button type="button" onClick={() => window.location.reload()} className="rounded-full bg-[#f8f4eb] px-3.5 py-1.5 text-xs font-semibold text-[#1f1c17] hover:bg-white">
          {t("Reload")}
        </button>
      </div>
    </div>
  );
}
