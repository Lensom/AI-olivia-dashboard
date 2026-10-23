"use client";

import { useState } from "react";

/** Company / fund logo (Financial Modeling Prep image CDN); falls back to the ticker's first letters. */
export function TickerLogo({ ticker, size = 32 }: { ticker: string; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = "flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/5 bg-white";
  if (!ticker || failed === ticker) {
    return (
      <span className={`${box} bg-[#f4efe4] font-semibold text-[#6f675b]`} style={{ width: size, height: size, fontSize: size * 0.34 }} aria-hidden>
        {ticker.slice(0, 2) || "?"}
      </span>
    );
  }
  return (
    <span className={box} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- external logo CDN, tiny images */}
      <img
        src={`https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`}
        alt=""
        loading="lazy"
        onError={() => setFailed(ticker)}
        className="h-full w-full object-contain p-1"
      />
    </span>
  );
}
