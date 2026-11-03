/** Shared layout tokens for Investing subpages (toolbar, tables, spacing). */

export const investingPageStack = "space-y-5";

/** Wrapper around wide data tables (matches Activities / Holdings). */
export const investingTableScrollWrap = "overflow-x-auto rounded-xl border border-black/5";

export const investingSubsectionStack = "space-y-2";

export const investingToolbarBtn =
  "rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]";

export const investingToolbarBtnSm =
  "rounded-full border border-black/10 bg-white px-3 py-1 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]";

export const investingMetaBadge =
  "rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[#6f675b]";

export const investingPrimarySaveActive =
  "rounded-full bg-[#1f1c17] px-3.5 py-1.5 text-xs font-medium text-[#f8f4eb] hover:bg-[#2c2923]";

export const investingPrimarySaveDisabled =
  "cursor-not-allowed rounded-full bg-black/10 px-3.5 py-1.5 text-xs font-medium text-[#6f675b]";

/**
 * A row of chips, badges or buttons that wraps on desktop and becomes one swipeable line on phones
 * (see `.scroll-row` in globals.css). Use it for page-level rows, not inside cards.
 */
export const scrollRow = "scroll-row flex flex-wrap items-center gap-2";

/** Horizontal pill tabs (Crypto + Stocks workspaces, Cinematography, Library, Life). */
export const investingTabNavWrap = "scroll-row flex flex-wrap gap-2 border-b border-black/5 pb-3";

const investingTabPillBase = "rounded-full px-3.5 py-1.5 text-xs font-medium transition";

export const investingTabPillActive = `${investingTabPillBase} bg-[#1f1c17] text-[#f8f4eb]`;

export const investingTabPillIdle = `${investingTabPillBase} border border-black/10 bg-white text-[#3b352d] hover:bg-[#faf8f2]`;
