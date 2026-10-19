"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { EN_PLURALS, UK } from "@/lib/i18n/uk";

/**
 * Interface language. English strings are the keys: `t("Add task")`, `t("{n} titles", { n })`.
 * A missing Ukrainian entry falls back to English, so nothing ever shows a raw key.
 * Only interface text is translated; your data (titles, genres, notes, list names) stays as entered.
 */
export type Lang = "en" | "uk";
export type TVars = Record<string, string | number>;
export type T = (key: string, vars?: TVars) => string;

const KEY = "olivia.lang.v1";
const EVENT = "olivia:lang";

function read(): Lang {
  try {
    return window.localStorage.getItem(KEY) === "uk" ? "uk" : "en";
  } catch {
    return "en";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Ukrainian plural form: 1 фільм · 2 фільми · 5 фільмів (fractions take the "few" form). */
function ukForm(n: number): 0 | 1 | 2 {
  if (!Number.isInteger(n)) return 1;
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (b === 1 && a !== 11) return 0;
  if (b >= 2 && b <= 4 && (a < 12 || a > 14)) return 1;
  return 2;
}

export function translate(lang: Lang, key: string, vars?: TVars): string {
  const n = typeof vars?.n === "number" ? vars.n : null;
  let s: string;
  if (lang === "uk") {
    const v = UK[key];
    s = Array.isArray(v) ? v[n == null ? 2 : ukForm(n)] : (v ?? key);
  } else {
    const v = EN_PLURALS[key];
    s = v && n != null ? v[n === 1 ? 0 : 1] : key;
  }
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s;
}

export function useLang(): [Lang, (l: Lang) => void] {
  // Server render and the first client render are English; the saved choice applies right after.
  const lang = useSyncExternalStore(subscribe, read, () => "en" as Lang);
  const set = useCallback((l: Lang) => {
    try {
      window.localStorage.setItem(KEY, l);
    } catch {
      // Not remembered, but still switches for this visit.
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return [lang, set];
}

export function useT(): T {
  const [lang] = useLang();
  return useCallback((key: string, vars?: TVars) => translate(lang, key, vars), [lang]);
}

/** Locale for dates and numbers that follow the interface language. */
export function useLocale(): string {
  const [lang] = useLang();
  return lang === "uk" ? "uk-UA" : "en-US";
}
