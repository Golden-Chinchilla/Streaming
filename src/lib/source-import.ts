import Papa from "papaparse";
import * as XLSX from "xlsx";

const SOURCE_CANDIDATES = ["source", "from", "src", "origin"];
const TARGET_CANDIDATES = ["target", "to", "dst", "destination"];
const VALUE_CANDIDATES = ["value", "amount", "weight", "count", "volume"];

export type TableMapping = {
  source: string;
  target: string;
  value: string;
};

export type TablePreview = {
  headers: string[];
  rows: Record<string, string>[];
  mapping: TableMapping;
};

export type ImportTransformOptions = {
  valuePolicy?: "drop" | "clamp";
  minValue?: number;
};

export type ImportTransformStats = {
  totalRows: number;
  outputRows: number;
  droppedRows: number;
  clampedRows: number;
};

export type CanonicalLink = {
  source: string;
  target: string;
  value: number;
};

export function detectMapping(headers: string[]): TableMapping {
  const lower = headers.map((header) => header.toLowerCase());
  const pick = (candidates: string[], fallbackIndex: number) => {
    const match = lower.findIndex((header) => candidates.includes(header));
    if (match >= 0) return headers[match];
    return headers[Math.min(fallbackIndex, Math.max(0, headers.length - 1))] ?? "";
  };

  return {
    source: pick(SOURCE_CANDIDATES, 0),
    target: pick(TARGET_CANDIDATES, 1),
    value: pick(VALUE_CANDIDATES, 2),
  };
}

export function rowsToCanonicalCsv(
  rows: Record<string, string>[],
  mapping: TableMapping,
): string {
  const transformed = transformRowsToCanonicalLinks(rows, mapping);
  return linksToCanonicalCsv(transformed.links);
}

export function rowsToCanonicalLinks(
  rows: Record<string, string>[],
  mapping: TableMapping,
) {
  return transformRowsToCanonicalLinks(rows, mapping).links;
}

export function rowsToCanonicalJson(
  rows: Record<string, string>[],
  mapping: TableMapping,
) {
  const transformed = transformRowsToCanonicalLinks(rows, mapping);
  return linksToCanonicalJson(transformed.links);
}

export function linksToCanonicalCsv(links: CanonicalLink[]) {
  const lines = ["source,target,value"];
  for (const link of links) {
    lines.push(
      `${escapeCsv(link.source)},${escapeCsv(link.target)},${escapeCsv(String(link.value))}`,
    );
  }
  return lines.join("\n");
}

export function linksToCanonicalJson(links: CanonicalLink[]) {
  return JSON.stringify(links, null, 2);
}

export function transformRowsToCanonicalLinks(
  rows: Record<string, string>[],
  mapping: TableMapping,
  options?: ImportTransformOptions,
): { links: CanonicalLink[]; stats: ImportTransformStats } {
  const valuePolicy = options?.valuePolicy ?? "drop";
  const minValue = Math.max(0.0001, options?.minValue ?? 1);
  const links: CanonicalLink[] = [];
  let droppedRows = 0;
  let clampedRows = 0;

  for (const row of rows) {
    const source = (row[mapping.source] ?? "").trim();
    const target = (row[mapping.target] ?? "").trim();
    const valueText = String(row[mapping.value] ?? "").trim();
    const parsed = Number(valueText);

    if (!source || !target) {
      droppedRows += 1;
      continue;
    }

    if (!Number.isFinite(parsed) || parsed <= 0) {
      if (valuePolicy === "clamp") {
        links.push({ source, target, value: minValue });
        clampedRows += 1;
      } else {
        droppedRows += 1;
      }
      continue;
    }

    links.push({ source, target, value: parsed });
  }

  return {
    links,
    stats: {
      totalRows: rows.length,
      outputRows: links.length,
      droppedRows,
      clampedRows,
    },
  };
}

function escapeCsv(value: string) {
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function sanitizeRows(inputRows: Record<string, unknown>[]) {
  return inputRows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      normalized[key] = String(row[key] ?? "");
    }
    return normalized;
  });
}

export function parseJsonPreview(text: string): TablePreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid JSON");
  }

  const rawRows = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && "links" in parsed
      ? (parsed as { links: unknown }).links
      : null;

  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    throw new Error("JSON must be an array of objects or an object with links[]");
  }

  const objectRows = rawRows.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null && !Array.isArray(row),
  );

  if (objectRows.length === 0) {
    throw new Error("JSON rows must be objects");
  }

  const rows = sanitizeRows(objectRows);
  const headers = Object.keys(rows[0] ?? {});
  if (headers.length === 0) {
    throw new Error("No fields found in JSON rows");
  }

  return {
    headers,
    rows,
    mapping: detectMapping(headers),
  };
}

export function parseCsvPreview(text: string): TablePreview {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (result.errors.length) {
    throw new Error(result.errors[0].message);
  }

  const rows = result.data;
  const headers = result.meta.fields ?? Object.keys(rows[0] ?? {});
  if (headers.length === 0 || rows.length === 0) {
    throw new Error("No tabular rows found in CSV");
  }

  return {
    headers,
    rows,
    mapping: detectMapping(headers),
  };
}

export function parseXlsxPreview(fileBuffer: ArrayBuffer): TablePreview {
  const workbook = XLSX.read(fileBuffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("Workbook has no sheet");
  }
  const sheet = workbook.Sheets[firstSheetName];
  const rows = sanitizeRows(
    XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }),
  );
  const headers = Object.keys(rows[0] ?? {});
  if (headers.length === 0 || rows.length === 0) {
    throw new Error("No tabular rows found in sheet");
  }
  return {
    headers,
    rows,
    mapping: detectMapping(headers),
  };
}

export function previewToRows(preview: TablePreview) {
  return preview.rows.slice(0, 5);
}
