import { COMMON } from "@/lib/i18n/common";
import { INVESTING } from "@/lib/i18n/investing";
import { MEDIA } from "@/lib/i18n/media";
import { PAGES } from "@/lib/i18n/pages";

/**
 * Ukrainian dictionary, keyed by the English interface text. A string[] value holds the plural
 * forms [one, few, many] (1 фільм · 2 фільми · 5 фільмів) and is picked by the `n` variable.
 */
export const UK: Record<string, string | string[]> = {
  ...COMMON,
  ...MEDIA,
  ...INVESTING,
  ...PAGES,
};

/** English plural forms [one, other] for keys that take `n`. */
export const EN_PLURALS: Record<string, [string, string]> = {
  "{n} titles": ["{n} title", "{n} titles"],
  "{n} films": ["{n} film", "{n} films"],
  "{n} cartoons": ["{n} cartoon", "{n} cartoons"],
  "{n} TV shows": ["{n} TV show", "{n} TV shows"],
  "{n} books": ["{n} book", "{n} books"],
  "{n} comics": ["{n} comic", "{n} comics"],
  "{n} magazines": ["{n} magazine", "{n} magazines"],
  "{n} seasons": ["{n} season", "{n} seasons"],
  "{n} votes": ["{n} vote", "{n} votes"],
  "{n} pages": ["{n} page", "{n} pages"],
  "{n} pages read in total": ["{n} page read in total", "{n} pages read in total"],
  "{n} stars": ["{n} star", "{n} stars"],
  "{n} new titles": ["{n} new title", "{n} new titles"],
  "{n} rows without a title": ["{n} row without a title", "{n} rows without a title"],
  "Added {n} titles.": ["Added {n} title.", "Added {n} titles."],
  "Filled {n} titles from TMDB.": ["Filled {n} title from TMDB.", "Filled {n} titles from TMDB."],
  "Filled {n} titles.": ["Filled {n} title.", "Filled {n} titles."],
  "Fill {n} titles": ["Fill {n} title", "Fill {n} titles"],
  "{n} graded titles by score, 1–10": ["{n} graded title by score, 1–10", "{n} graded titles by score, 1–10"],
  "{n} graded titles by stars": ["{n} graded title by stars", "{n} graded titles by stars"],
  "{n} watched titles": ["{n} watched title", "{n} watched titles"],
  "{n} books read": ["{n} book read", "{n} books read"],
  "IMDb {v} on the same {n} titles": ["IMDb {v} on the same title", "IMDb {v} on the same {n} titles"],
  "Readers’ average from {n} ratings": ["Readers’ average from {n} rating", "Readers’ average from {n} ratings"],
  // Investing
  "{n} holdings": ["{n} holding", "{n} holdings"],
  "{n} trades": ["{n} trade", "{n} trades"],
  "{n} words": ["{n} word", "{n} words"],
  "{n} rules": ["{n} rule", "{n} rules"],
  "{n} opportunities": ["{n} opportunity", "{n} opportunities"],
  "{n} refills": ["{n} refill", "{n} refills"],
  "{n} days ago": ["{n} day ago", "{n} days ago"],
  "{n} buys": ["{n} buy", "{n} buys"],
  "{n} purchase days": ["{n} purchase day", "{n} purchase days"],
  "{n} holdings off target by ≥ {pp} pp": ["{n} holding off target by ≥ {pp} pp", "{n} holdings off target by ≥ {pp} pp"],
  "{n} positions · cost {v}": ["{n} position · cost {v}", "{n} positions · cost {v}"],
  "of {n} positions": ["of {n} position", "of {n} positions"],
  "Added {n} trades ({buys} buys, {sells} sells) at the top — review and press Save.": [
    "Added {n} trade ({buys} buys, {sells} sells) at the top — review and press Save.",
    "Added {n} trades ({buys} buys, {sells} sells) at the top — review and press Save.",
  ],
  "Beat the index in {beat} of {n} years": ["Beat the index in {beat} of {n} year", "Beat the index in {beat} of {n} years"],
  "Clear {n} completed": ["Clear {n} completed", "Clear {n} completed"],
  "Charts and insights for all titles or one type. {n} titles in view.": ["Charts and insights for all titles or one type. {n} title in view.", "Charts and insights for all titles or one type. {n} titles in view."],
  "within ±1 point, {n} titles": ["within ±1 point, {n} title", "within ±1 point, {n} titles"],
  // Life
  "{n} subpages": ["{n} subpage", "{n} subpages"],
  "Delete this table and its {n} rows?": ["Delete this table and its {n} row?", "Delete this table and its {n} rows?"],
};
