/**
 * Compact filter controls (sort selects, search, segmented pills) at one height, so a filter row lines up on phones.
 * On a phone the search takes the rest of the row next to a select; on wider screens it sits at the row's end.
 */
export const filterSelect =
  "h-8 min-w-0 shrink-0 rounded-full border border-black/10 bg-white pl-3 pr-2 text-xs text-[#3b352d] outline-none focus:border-black/25";

export const filterSearch =
  "h-8 min-w-0 flex-1 basis-40 rounded-full border border-black/10 bg-white px-3.5 text-xs outline-none focus:border-black/25 sm:ml-auto sm:w-56 sm:flex-none sm:basis-auto";
