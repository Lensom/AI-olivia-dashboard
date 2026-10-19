/** Mirrors back/app/pages/router.py. */
export type PageKind = "doc" | "table";

export type PageSummary = {
  id: string;
  parent_id: string | null;
  title: string;
  icon: string;
  kind: PageKind;
  sort_order: number;
  updated_at: string | null;
};

export type Page = PageSummary & { content: unknown };

/** Table pages: a Notion-style database split into titled sections that share the same columns. */
export type ColumnType = "title" | "text" | "url" | "number" | "checkbox" | "select" | "date";
export type TableColumn = { id: string; name: string; type: ColumnType };
export type CellValue = string | number | boolean | null;
export type TableRow = { id: string; cells: Record<string, CellValue> };
export type TableSection = { id: string; title: string; rows: TableRow[] };
export type TableContent = { columns: TableColumn[]; sections: TableSection[] };

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}${Math.random()}`;

/** A new table; column names are created in the interface language (they are your data afterwards). */
export function emptyTable(t: (key: string) => string = (k) => k): TableContent {
  return {
    columns: [
      { id: newId(), name: t("Done"), type: "checkbox" },
      { id: newId(), name: t("Title"), type: "title" },
      { id: newId(), name: t("Notes"), type: "text" },
    ],
    sections: [{ id: newId(), title: "", rows: [] }],
  };
}

export const defaultIcon = (kind: PageKind) => (kind === "table" ? "▦" : "📄");
