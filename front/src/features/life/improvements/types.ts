import { newId } from "@/features/life/places/types";

/** Mirrors back/app/improvements/router.py. */
export type Status = "todo" | "in_progress" | "done";
export type Item = {
  id: string;
  name: string;
  details: string;
  status: Status;
  links: string[];
  note: string;
  /** Pinned to "Focus now". */
  focus: boolean;
  /** When the status last changed (ISO). */
  changed_at: string;
};
export type Group = { id: string; emoji: string; title: string; items: Item[] };
export type Section = { id: string; title: string; groups: Group[] };
export type Improvements = { sections: Section[] };

export type StatusFilter = Status | "all";
export type Sort = "sections" | "in_progress" | "todo" | "done" | "name";

/** Green done, yellow in progress, plain not started — as in the list this page came from. */
export const STATUSES: { value: Status; label: string; pill: string; dot: string; border: string }[] = [
  { value: "in_progress", label: "Underway", pill: "bg-amber-100 text-amber-900 hover:bg-amber-200", dot: "bg-amber-400", border: "border-amber-300" },
  { value: "done", label: "Achieved", pill: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200", dot: "bg-emerald-500", border: "border-emerald-300" },
  { value: "todo", label: "Not yet started", pill: "bg-[#f1ece2] text-[#5f574b] hover:bg-[#e7dfcf]", dot: "bg-[#cfc6b6]", border: "border-black/5" },
];
export const statusMeta = (s: Status) => STATUSES.find((x) => x.value === s) ?? STATUSES[2];

/** One tap moves a habit along: not started → in progress → done → not started. */
export const nextStatus = (s: Status): Status => (s === "todo" ? "in_progress" : s === "in_progress" ? "done" : "todo");

export const SORTS: { value: Sort; label: string }[] = [
  { value: "sections", label: "By area" },
  { value: "in_progress", label: "Underway first" },
  { value: "todo", label: "Not yet started first" },
  { value: "done", label: "Achieved first" },
  { value: "name", label: "By name" },
];

export const emptyItem = (): Item => ({ id: newId(), name: "", details: "", status: "todo", links: [], note: "", focus: false, changed_at: "" });

const asText = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const asStatus = (v: unknown): Status => (v === "done" || v === "in_progress" ? v : "todo");
const slugId = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : newId());

/**
 * A list in the shape it was written in (sections → groups → items with name, details, status, links; ids optional),
 * as this page keeps it. Throws with a readable message when it isn't that shape.
 */
export function parseImport(text: string): Improvements {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This isn't valid JSON.");
  }
  const sections = (raw as { sections?: unknown })?.sections;
  if (!Array.isArray(sections) || !sections.length) throw new Error("Expected a \"sections\" list.");
  return {
    sections: sections.slice(0, 50).map((s) => ({
      id: slugId(s?.id),
      title: asText(s?.title, 150) || "—",
      groups: (Array.isArray(s?.groups) ? s.groups : []).slice(0, 50).map((g: Record<string, unknown>) => ({
        id: slugId(g?.id),
        emoji: asText(g?.emoji, 16),
        title: asText(g?.title, 150) || "—",
        items: (Array.isArray(g?.items) ? g.items : [])
          .filter((i: Record<string, unknown>) => asText(i?.name, 300))
          .slice(0, 200)
          .map((i: Record<string, unknown>) => ({
            id: slugId(i?.id),
            name: asText(i?.name, 300),
            details: asText(i?.details, 2000),
            status: asStatus(i?.status),
            links: (Array.isArray(i?.links) ? i.links : []).filter((l: unknown) => typeof l === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(l.trim())).map((l: string) => l.trim()).slice(0, 20),
            note: asText(i?.note, 4000),
            focus: i?.focus === true,
            changed_at: asText(i?.changed_at, 40), // unknown for an imported one: it isn't "recently done"
          })),
      })),
    })),
  };
}

/** "https://www.linkedin.com/in/…" -> "linkedin.com", for a link's label. */
export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
