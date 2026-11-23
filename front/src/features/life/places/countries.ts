import isoCountries from "i18n-iso-countries";
import { countriesOf, norm } from "./types";

/** Every ISO 3166 country and territory (two-letter codes), for the "My countries" picker. */
export const ALL_CODES: string[] = Object.keys(isoCountries.getAlpha2Codes()).filter((c) => c !== "AQ");

/** Countries of the world as usually counted (UN members and observers): what "N of 195" is out of. */
export const WORLD_COUNTRIES = 195;

const namers = new Map<string, Intl.DisplayNames>();

/** "FR" -> "Франція" in this locale; the code itself when the browser can't name it. */
export function countryName(code: string, locale: string): string {
  let namer = namers.get(locale);
  if (!namer) {
    namer = new Intl.DisplayNames([locale], { type: "region" });
    namers.set(locale, namer);
  }
  try {
    return namer.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Names a place's location may use that differ from the official ones. */
const ALIASES: Record<string, string> = {
  сша: "US", америка: "US", usa: "US", us: "US",
  оае: "AE", uae: "AE",
  англія: "GB", шотландія: "GB", уельс: "GB", england: "GB", scotland: "GB", uk: "GB", британія: "GB",
  чехія: "CZ", "південна корея": "KR", корея: "KR", голландія: "NL",
};

let byName: Map<string, string> | null = null;

/** Case, accents and the kind of apostrophe don't matter: В'єтнам = Вʼєтнам = В’єтнам. */
const key = (s: string) => norm(s.trim()).replace(/['’ʼ`]/g, "");

/** "Франція" / "France" / "США" -> its code; null when it isn't a country (a region, "Лапландія"). */
export function codeFromName(name: string): string | null {
  if (!byName) {
    byName = new Map();
    for (const code of ALL_CODES) for (const locale of ["uk", "en"]) byName.set(key(countryName(code, locale)), code);
  }
  const k = key(name);
  return ALIASES[k] ?? byName.get(k) ?? null;
}

/** The countries of these locations that can be named, as codes: "Париж, Франція" -> FR. */
export function codesOfLocations(locations: string[]): string[] {
  const codes = new Set<string>();
  for (const loc of locations) for (const name of countriesOf(loc)) {
    const code = codeFromName(name);
    if (code) codes.add(code);
  }
  return [...codes];
}

/** world-atlas numbers its shapes by ISO numeric code (a few, like Kosovo, by name only). */
export function codeOfShape(id: string | number | undefined, name: string | undefined): string | null {
  if (id != null && id !== "") {
    const code = isoCountries.numericToAlpha2(String(id));
    if (code) return code;
  }
  return name === "Kosovo" ? "XK" : null;
}
