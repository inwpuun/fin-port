/**
 * Minimal RFC 4180 CSV reader. Pure and dependency-free so it can be shared
 * by the Next.js server and the plain-node import CLI.
 *
 * Handles: UTF-8 BOM, a leading Excel `sep=,` directive, quoted fields with
 * embedded commas / newlines / doubled quotes, and CRLF.
 */
export function parseCsv(input: string): string[][] {
  let text = input.replace(/^﻿/, "");
  if (/^sep=./i.test(text)) text = text.slice(text.indexOf("\n") + 1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let dirty = false;

  const endField = () => {
    row.push(field);
    field = "";
    dirty = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    dirty = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\n") endRow();
    else if (char !== "\r") field += char;
  }

  if (dirty || field) endRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Reads a CSV whose first row is a header into keyed records. */
export function parseCsvRecords(input: string): Array<Record<string, string>> {
  const rows = parseCsv(input);
  if (!rows.length) return [];
  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  return rows.slice(1).map((cells) =>
    Object.fromEntries(header.map((key, index) => [key, (cells[index] ?? "").trim()]))
  );
}

/** "-1,083.51" / "+4,586.04" / "" -> number | null */
export function parseAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[,\s ]/g, "").replace(/^\+/, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
