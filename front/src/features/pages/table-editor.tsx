"use client";

import { useRef, useState } from "react";
import { tagColor } from "@/features/cinema/types";
import { newId, type CellValue, type ColumnType, type TableColumn, type TableContent, type TableRow } from "@/features/pages/types";
import { useLocale, useT } from "@/lib/i18n";

const TYPES: { value: ColumnType; label: string; icon: string }[] = [
  { value: "title", label: "Title", icon: "Aa" },
  { value: "text", label: "Text", icon: "≡" },
  { value: "number", label: "Number", icon: "#" },
  { value: "checkbox", label: "Checkbox", icon: "☑" },
  { value: "select", label: "Category", icon: "◉" },
  { value: "url", label: "Link", icon: "🔗" },
  { value: "date", label: "Date", icon: "📅" },
];
const typeIcon = (t: ColumnType) => TYPES.find((x) => x.value === t)?.icon ?? "≡";

const toNumber = (v: CellValue) => {
  if (typeof v === "number") return v;
  const raw = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  if (!raw) return null; // empty stays empty, not 0
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Minimal CSV parser (quotes, commas or semicolons) for Notion / spreadsheet exports. */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const delim = (clean.split("\n")[0]?.match(/;/g)?.length ?? 0) > (clean.split("\n")[0]?.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Guesses column types from the values, the way a Notion export reads back. */
function guessType(name: string, values: string[], index: number): ColumnType {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (index === 0) return "title";
  if (!filled.length) return "text";
  if (filled.every((v) => /^(yes|no|true|false|так|ні)$/i.test(v))) return "checkbox";
  if (filled.every((v) => /^https?:\/\//i.test(v))) return "url";
  if (filled.every((v) => toNumber(v) != null)) return "number";
  if (/date|дата/i.test(name)) return "date";
  const distinct = new Set(filled);
  return distinct.size <= Math.max(3, filled.length / 2) ? "select" : "text";
}

type Props = { value: TableContent; onChange: (next: TableContent) => void };

export function TableEditor({ value, onChange }: Props) {
  const t = useT();
  const locale = useLocale();
  const [colMenu, setColMenu] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { columns, sections } = value;

  const set = (next: Partial<TableContent>) => onChange({ ...value, ...next });
  const setCell = (sectionId: string, rowId: string, colId: string, v: CellValue) =>
    set({
      sections: sections.map((s) =>
        s.id !== sectionId ? s : { ...s, rows: s.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: v } } : r)) },
      ),
    });
  const patchColumn = (id: string, patch: Partial<TableColumn>) => set({ columns: columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const moveColumn = (id: string, dir: -1 | 1) => {
    const i = columns.findIndex((c) => c.id === id);
    const j = i + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set({ columns: next });
  };
  const moveRow = (sectionId: string, rowId: string, dir: -1 | 1) =>
    set({
      sections: sections.map((s) => {
        if (s.id !== sectionId) return s;
        const i = s.rows.findIndex((r) => r.id === rowId);
        const j = i + dir;
        if (j < 0 || j >= s.rows.length) return s;
        const rows = [...s.rows];
        [rows[i], rows[j]] = [rows[j]!, rows[i]!];
        return { ...s, rows };
      }),
    });

  async function importCsv(file: File) {
    const table = parseCsv(await file.text());
    if (table.length < 1) return;
    const [header, ...body] = table;
    // An empty table takes the file's columns as they are; otherwise columns with the same name are reused.
    const isEmpty = sections.every((s) => s.rows.length === 0);
    const cols = isEmpty ? [] : [...columns];
    const map = header!.map((name, i) => {
      const existing = isEmpty ? undefined : cols.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (existing) return existing.id;
      const col: TableColumn = { id: newId(), name: name.trim() || t("Column"), type: guessType(name, body.map((r) => r[i] ?? ""), i) };
      cols.push(col);
      return col.id;
    });
    // Like the Notion view: the ✓ column first (Notion's CSV export usually puts it last).
    if (isEmpty) cols.sort((a, b) => Number(b.type === "checkbox") - Number(a.type === "checkbox"));
    const typeOf = (id: string) => cols.find((c) => c.id === id)?.type ?? "text";
    const rows: TableRow[] = body.map((r) => ({
      id: newId(),
      cells: Object.fromEntries(
        map.map((colId, i) => {
          const raw = (r[i] ?? "").trim();
          const ty = typeOf(colId);
          return [colId, ty === "checkbox" ? /^(yes|true|так)$/i.test(raw) : ty === "number" ? toNumber(raw) : raw];
        }),
      ),
    }));
    const title = file.name.replace(/\.[^.]+$/, "").replace(/\s+[0-9a-f]{32}$/i, "");
    const onlyEmpty = sections.length === 1 && sections[0]!.rows.length === 0;
    onChange({
      columns: cols,
      sections: onlyEmpty ? [{ ...sections[0]!, title: sections[0]!.title || title, rows }] : [...sections, { id: newId(), title, rows }],
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function cell(col: TableColumn, sectionId: string, row: TableRow) {
    const v = row.cells[col.id] ?? null;
    const base = "w-full bg-transparent px-2 py-1.5 text-sm text-[#2f2922] outline-none focus:bg-white focus:ring-1 focus:ring-black/15 rounded";
    switch (col.type) {
      case "checkbox":
        return (
          <input
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => setCell(sectionId, row.id, col.id, e.target.checked)}
            aria-label={col.name}
            className="mx-2 h-4 w-4 cursor-pointer accent-[#2a78d6]"
          />
        );
      case "number":
        return (
          <input
            value={v == null ? "" : String(v)}
            onChange={(e) => setCell(sectionId, row.id, col.id, e.target.value === "" ? null : (toNumber(e.target.value) ?? e.target.value))}
            inputMode="decimal"
            aria-label={col.name}
            className={`${base} text-right tabular-nums`}
          />
        );
      case "date":
        return <input type="date" value={String(v ?? "")} onChange={(e) => setCell(sectionId, row.id, col.id, e.target.value)} aria-label={col.name} className={base} />;
      case "url": {
        const href = String(v ?? "").trim();
        return (
          <span className="flex items-center">
            <input value={href} onChange={(e) => setCell(sectionId, row.id, col.id, e.target.value)} aria-label={col.name} placeholder="https://" className={`${base} min-w-0 text-xs text-[#8f8676]`} />
            {/^https?:\/\//i.test(href) ? (
              <a href={href} target="_blank" rel="noreferrer" className="shrink-0 px-1 text-xs text-[#2a78d6] underline" title={href}>
                {t("link")}
              </a>
            ) : null}
          </span>
        );
      }
      case "select": {
        const text = String(v ?? "");
        return (
          <span className="flex items-center px-1">
            <input
              value={text}
              onChange={(e) => setCell(sectionId, row.id, col.id, e.target.value)}
              list={`opts-${col.id}`}
              aria-label={col.name}
              className={`w-full rounded px-1.5 py-0.5 text-[12px] font-medium outline-none focus:ring-1 focus:ring-black/15 ${text ? tagColor(text) : "bg-transparent"}`}
            />
          </span>
        );
      }
      default:
        return (
          <input
            value={String(v ?? "")}
            onChange={(e) => setCell(sectionId, row.id, col.id, e.target.value)}
            aria-label={col.name}
            className={`${base} ${col.type === "title" ? "font-medium text-[#1f1c17]" : ""}`}
          />
        );
    }
  }

  return (
    <div className="space-y-8">
      {columns
        .filter((c) => c.type === "select")
        .map((c) => (
          <datalist key={c.id} id={`opts-${c.id}`}>
            {[...new Set(sections.flatMap((s) => s.rows.map((r) => String(r.cells[c.id] ?? "")).filter(Boolean)))].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        ))}

      {sections.map((s) => (
        <section key={s.id}>
          <div className="mb-2 flex items-center gap-2">
            <input
              value={s.title}
              onChange={(e) => set({ sections: sections.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })}
              placeholder={t("Untitled table")}
              className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-[#1f1c17] outline-none placeholder:text-[#c4bcae]"
            />
            {sections.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (s.rows.length && !window.confirm(t("Delete this table and its {n} rows?", { n: s.rows.length }))) return;
                  set({ sections: sections.filter((x) => x.id !== s.id) });
                }}
                className="text-xs text-[#a39a89] hover:text-rose-700"
              >
                {t("Delete table")}
              </button>
            ) : null}
          </div>
          <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-black/10 text-xs text-[#8f8676]">
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      className={`relative border-r border-black/5 px-0 py-0 font-medium ${c.type === "checkbox" ? "w-10" : c.type === "number" ? "w-32" : c.type === "title" ? "min-w-[200px]" : "min-w-[120px]"}`}
                    >
                      <button
                        type="button"
                        onClick={() => setColMenu(colMenu === `${s.id}:${c.id}` ? null : `${s.id}:${c.id}`)}
                        className={`flex w-full items-center gap-1.5 px-2 py-2 hover:bg-[#faf8f2] ${c.type === "number" ? "justify-end" : ""}`}
                        title={t("Column settings")}
                      >
                        <span aria-hidden className="text-[11px] opacity-70">
                          {typeIcon(c.type)}
                        </span>
                        {c.type === "checkbox" ? null : <span className="truncate">{c.name}</span>}
                      </button>
                      {colMenu === `${s.id}:${c.id}` ? (
                        <div className="absolute left-0 top-full z-30 mt-1 w-56 space-y-1 rounded-xl border border-black/10 bg-white p-2 text-sm font-normal text-[#2f2922] shadow-lg">
                          <input
                            value={c.name}
                            onChange={(e) => patchColumn(c.id, { name: e.target.value })}
                            className="w-full rounded-lg border border-black/10 px-2 py-1 text-sm outline-none focus:border-black/25"
                            autoFocus
                            aria-label={t("Column name")}
                          />
                          <select
                            value={c.type}
                            onChange={(e) => patchColumn(c.id, { type: e.target.value as ColumnType })}
                            className="w-full rounded-lg border border-black/10 px-2 py-1 text-sm"
                            aria-label={t("Column type")}
                          >
                            {TYPES.map((ty) => (
                              <option key={ty.value} value={ty.value}>
                                {ty.icon} {t(ty.label)}
                              </option>
                            ))}
                          </select>
                          <div className="flex gap-1">
                            <button type="button" onClick={() => moveColumn(c.id, -1)} className="flex-1 rounded-lg px-2 py-1 text-xs hover:bg-[#faf8f2]">
                              ← {t("Move left")}
                            </button>
                            <button type="button" onClick={() => moveColumn(c.id, 1)} className="flex-1 rounded-lg px-2 py-1 text-xs hover:bg-[#faf8f2]">
                              {t("Move right")} →
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setColMenu(null);
                              set({ columns: columns.filter((x) => x.id !== c.id) });
                            }}
                            className="block w-full rounded-lg px-2 py-1 text-left text-xs text-rose-700 hover:bg-rose-50"
                          >
                            {t("Delete column")}
                          </button>
                          <button type="button" onClick={() => setColMenu(null)} className="block w-full rounded-lg px-2 py-1 text-left text-xs text-[#6f675b] hover:bg-[#faf8f2]">
                            {t("Done")}
                          </button>
                        </div>
                      ) : null}
                    </th>
                  ))}
                  <th className="w-10 px-0 py-0">
                    <button
                      type="button"
                      onClick={() => {
                        const col: TableColumn = { id: newId(), name: t("Column"), type: "text" };
                        set({ columns: [...columns, col] });
                        setColMenu(`${s.id}:${col.id}`);
                      }}
                      className="w-full px-2 py-2 text-[#a39a89] hover:bg-[#faf8f2] hover:text-[#1f1c17]"
                      aria-label={t("Add column")}
                      title={t("Add column")}
                    >
                      +
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={r.id} className="group border-b border-black/5 hover:bg-[#fcfbf7]">
                    {columns.map((c) => (
                      <td key={c.id} className="border-r border-black/5 p-0 align-middle">
                        {cell(c, s.id, r)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap p-0 text-center">
                      <span className="flex items-center justify-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                        <button type="button" onClick={() => moveRow(s.id, r.id, -1)} disabled={i === 0} aria-label={t("Move up")} className="px-0.5 text-xs text-[#a39a89] hover:text-[#1f1c17] disabled:invisible">
                          ↑
                        </button>
                        <button type="button" onClick={() => moveRow(s.id, r.id, 1)} disabled={i === s.rows.length - 1} aria-label={t("Move down")} className="px-0.5 text-xs text-[#a39a89] hover:text-[#1f1c17] disabled:invisible">
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => set({ sections: sections.map((x) => (x.id === s.id ? { ...x, rows: x.rows.filter((y) => y.id !== r.id) } : x)) })}
                          aria-label={t("Delete row")}
                          className="px-0.5 text-xs text-[#a39a89] hover:text-rose-700"
                        >
                          ✕
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={columns.length + 1} className="p-0">
                    <button
                      type="button"
                      onClick={() => set({ sections: sections.map((x) => (x.id === s.id ? { ...x, rows: [...x.rows, { id: newId(), cells: {} }] } : x)) })}
                      className="w-full px-3 py-2 text-left text-sm text-[#a39a89] hover:bg-[#faf8f2] hover:text-[#1f1c17]"
                    >
                      + {t("New row")}
                    </button>
                  </td>
                </tr>
              </tbody>
              {columns.some((c) => c.type === "number") && s.rows.length ? (
                <tfoot>
                  <tr className="border-t border-black/10 text-xs text-[#8f8676]">
                    {columns.map((c) => {
                      if (c.type !== "number") return <td key={c.id} />;
                      const sum = s.rows.reduce((a, r) => a + (toNumber(r.cells[c.id] ?? null) ?? 0), 0);
                      return (
                        <td key={c.id} className="px-2 py-1.5 text-right tabular-nums">
                          <span className="mr-1 text-[10px] uppercase tracking-wide">{t("Sum")}</span>
                          <span className="text-sm font-medium text-[#3b352d]">{sum.toLocaleString(locale, { maximumFractionDigits: 2 })}</span>
                        </td>
                      );
                    })}
                    <td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      ))}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => set({ sections: [...sections, { id: newId(), title: "", rows: [] }] })}
          className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
        >
          + {t("Add another table")}
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded-full border border-black/10 bg-white px-3.5 py-1.5 text-xs font-medium text-[#3b352d] hover:bg-[#faf8f2]"
          title={t("Notion: ••• → Export → Markdown & CSV")}
        >
          {t("Import CSV")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importCsv(f);
          }}
        />
      </div>
    </div>
  );
}
