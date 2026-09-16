import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

export async function readCsv(path) {
  const contents = await readFile(path, "utf8");
  return parse(contents.replace(/^\uFEFF/, ""), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: false,
  });
}

export function text(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function truthy(value) {
  return ["true", "yes", "1"].includes(String(value ?? "").trim().toLowerCase());
}

export function frequencies(records, field) {
  return Object.fromEntries(
    [...records.reduce((counts, record) => {
      const key = text(record[field]) ?? "(blank)";
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map())].sort((left, right) => right[1] - left[1]),
  );
}
