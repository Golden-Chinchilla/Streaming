import Papa from "papaparse";
import { parse as parseJsonWithPointers } from "json-source-map";
import { z } from "zod";
import { DataFormat } from "@/lib/types";
import { SankeyGraph, SankeyLinkInput } from "./sankey-types";

const linkSchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
    value: z.coerce.number().positive(),
});

const jsonLinksSchema = z.array(linkSchema);
const objectSchema = z.object({
    links: jsonLinksSchema,
});

export type ParseIssue = {
    message: string;
    line: number;
    column: number;
};

type SankeyParseResult =
    | {
        ok: true;
        graph: SankeyGraph;
    }
    | {
        ok: false;
        issue: ParseIssue;
    };

type JsonSourcePosition = {
    line: number;
    column: number;
    pos: number;
};

type JsonSourcePointerEntry = {
    key?: JsonSourcePosition;
    keyEnd?: JsonSourcePosition;
    value?: JsonSourcePosition;
    valueEnd?: JsonSourcePosition;
};

function lineColumnFromIndex(text: string, index: number) {
    const safeIndex = Math.max(0, Math.min(text.length, index));
    const leading = text.slice(0, safeIndex);
    const lines = leading.split("\n");
    const line = lines.length;
    const column = (lines[lines.length - 1]?.length ?? 0) + 1;
    return { line, column };
}

function escapeJsonPointer(segment: string) {
    return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pathToPointer(path: (string | number)[]) {
    if (path.length === 0) return "";
    return `/${path.map((segment) => escapeJsonPointer(String(segment))).join("/")}`;
}

function toMarker(position: JsonSourcePosition): { line: number; column: number } {
    return {
        line: position.line + 1,
        column: position.column + 1,
    };
}

function findPointerMarker(
    pointers: Record<string, JsonSourcePointerEntry>,
    path: (string | number)[],
) {
    for (let depth = path.length; depth >= 0; depth--) {
        const pointer = pathToPointer(path.slice(0, depth));
        const entry = pointers[pointer];
        if (!entry) continue;
        if (entry.value) return toMarker(entry.value);
        if (entry.key) return toMarker(entry.key);
    }
    return { line: 1, column: 1 };
}

function extractJsonParseIssue(text: string, error: Error): ParseIssue {
    const byPosition = error.message.match(/position\s+(\d+)/i);
    if (byPosition) {
        const pos = Number(byPosition[1]);
        const { line, column } = lineColumnFromIndex(text, pos);
        return {
            message: `JSON parse error: ${error.message}`,
            line,
            column,
        };
    }

    const byLineColumn = error.message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (byLineColumn) {
        return {
            message: `JSON parse error: ${error.message}`,
            line: Number(byLineColumn[1]),
            column: Number(byLineColumn[2]),
        };
    }

    return { message: `JSON parse error: ${error.message}`, line: 1, column: 1 };
}

function splitCsvFieldStartColumns(line: string) {
    const starts = [1];
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            const isEscapedQuote = inQuotes && line[i + 1] === '"';
            if (isEscapedQuote) {
                i += 1;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }
        if (!inQuotes && char === ",") {
            starts.push(i + 2);
        }
    }

    return starts;
}

function getCsvFieldColumn(text: string, lineNumber: number, fieldIndex: number) {
    const lines = text.split(/\r?\n/);
    const rawLine = lines[lineNumber - 1] ?? "";
    const starts = splitCsvFieldStartColumns(rawLine);
    return starts[fieldIndex] ?? 1;
}

function buildGraph(links: SankeyLinkInput[]): SankeyGraph {
    const nodeSet = new Set<string>();
    for (const link of links) {
        nodeSet.add(link.source);
        nodeSet.add(link.target);
    }

    return {
        nodes: [...nodeSet].map((id) => ({ id })),
        links,
    };
}

function parseJson(text: string): SankeyParseResult {
    let parsed: unknown;
    let pointers: Record<string, JsonSourcePointerEntry> = {};
    try {
        const mapped = parseJsonWithPointers(text);
        parsed = mapped.data;
        pointers = mapped.pointers as Record<string, JsonSourcePointerEntry>;
    } catch (error) {
        if (error instanceof Error) {
            return { ok: false, issue: extractJsonParseIssue(text, error) };
        }
        return { ok: false, issue: { message: "JSON parse error", line: 1, column: 1 } };
    }

    try {
        const links =
            Array.isArray(parsed)
                ? jsonLinksSchema.parse(parsed)
                : objectSchema.parse(parsed).links;

        return { ok: true, graph: buildGraph(links) };
    } catch (error) {
        if (error instanceof z.ZodError) {
            const firstIssue = error.issues[0];
            const issuePath = (firstIssue?.path ?? []) as (string | number)[];
            const marker = findPointerMarker(pointers, issuePath);
            const path = issuePath.length > 0 ? issuePath.join(".") : "root";
            return {
                ok: false,
                issue: {
                    message: `JSON schema error near ${path}: ${firstIssue?.message ?? "invalid shape"}`,
                    line: marker.line,
                    column: marker.column,
                },
            };
        }
        return { ok: false, issue: { message: "JSON schema error", line: 1, column: 1 } };
    }
}

function parseCsv(text: string): SankeyParseResult {
    const result = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim().toLowerCase(),
    });

    if (result.errors.length > 0) {
        const firstError = result.errors[0];
        const line = (firstError.row ?? 0) + 1;
        return {
            ok: false,
            issue: { message: `CSV parse error: ${firstError.message}`, line, column: 1 },
        };
    }

    const links: SankeyLinkInput[] = [];
    const headers = (result.meta.fields ?? []).map((field) => field.trim().toLowerCase());
    const sourceIndex = headers.findIndex((field) => field === "source" || field === "from");
    const targetIndex = headers.findIndex((field) => field === "target" || field === "to");
    const valueIndex = headers.findIndex((field) => field === "value" || field === "amount");

    const missingHeaders: string[] = [];
    if (sourceIndex < 0) missingHeaders.push("source");
    if (targetIndex < 0) missingHeaders.push("target");
    if (valueIndex < 0) missingHeaders.push("value");

    if (missingHeaders.length > 0) {
        return {
            ok: false,
            issue: {
                message: `CSV header error: missing column(s) ${missingHeaders.join(", ")}`,
                line: 1,
                column: 1,
            },
        };
    }

    for (let index = 0; index < result.data.length; index++) {
        const row = result.data[index];
        const line = index + 2;
        const source = row.source ?? row.from;
        const target = row.target ?? row.to;
        const value = row.value ?? row.amount;

        const missingField =
            !source || source.trim().length === 0
                ? { label: "source", index: sourceIndex }
                : !target || target.trim().length === 0
                    ? { label: "target", index: targetIndex }
                    : !value || value.trim().length === 0
                        ? { label: "value", index: valueIndex }
                        : null;

        if (missingField) {
            const column =
                missingField.index >= 0 ? getCsvFieldColumn(text, line, missingField.index) : 1;
            return {
                ok: false,
                issue: {
                    message: `CSV schema error: "${missingField.label}" is required`,
                    line,
                    column,
                },
            };
        }

        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            const column = valueIndex >= 0 ? getCsvFieldColumn(text, line, valueIndex) : 1;
            return {
                ok: false,
                issue: {
                    message: 'CSV schema error: "value" must be a positive number',
                    line,
                    column,
                },
            };
        }

        const parsed = linkSchema.safeParse({
            source,
            target,
            value: numeric,
        });

        if (!parsed.success) {
            return {
                ok: false,
                issue: {
                    message: "CSV schema error: invalid row values",
                    line,
                    column: 1,
                },
            };
        }

        links.push(parsed.data);
    }

    if (links.length === 0) {
        return { ok: false, issue: { message: "CSV has no valid rows", line: 1, column: 1 } };
    }

    return { ok: true, graph: buildGraph(links) };
}

function parseFlowDsl(text: string): SankeyParseResult | null {
    const lines = text.split(/\r?\n/);
    const links: SankeyLinkInput[] = [];
    let sawDslCandidate = false;

    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const trimmed = rawLine.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("//")) continue;

        const match = rawLine.match(/^\s*(.+?)\s*\[\s*([^\]]+?)\s*\]\s*(.+?)\s*$/);
        if (!match) {
            if (rawLine.includes("[") || rawLine.includes("]")) {
                sawDslCandidate = true;
                return {
                    ok: false,
                    issue: {
                        message: 'Flow syntax error: expected "Source [value] Target"',
                        line: index + 1,
                        column: 1,
                    },
                };
            }
            continue;
        }

        sawDslCandidate = true;
        const source = match[1].trim();
        const valueText = match[2].trim();
        const target = match[3].trim();
        const numeric = Number(valueText.replace(/,/g, ""));

        if (!Number.isFinite(numeric) || numeric <= 0) {
            const valueColumn = Math.max(1, rawLine.indexOf(valueText) + 1);
            return {
                ok: false,
                issue: {
                    message: 'Flow syntax error: "value" must be a positive number',
                    line: index + 1,
                    column: valueColumn,
                },
            };
        }

        const parsed = linkSchema.safeParse({ source, target, value: numeric });
        if (!parsed.success) {
            return {
                ok: false,
                issue: {
                    message: "Flow syntax error: invalid row values",
                    line: index + 1,
                    column: 1,
                },
            };
        }

        links.push(parsed.data);
    }

    if (!sawDslCandidate) return null;
    if (links.length === 0) {
        return {
            ok: false,
            issue: {
                message: "Flow syntax error: no valid flow rows found",
                line: 1,
                column: 1,
            },
        };
    }

    return { ok: true, graph: buildGraph(links) };
}

export function parseSankeyText(text: string, format: DataFormat): SankeyGraph {
    const result = parseSankeyTextDetailed(text, format);
    if (!result.ok) {
        throw new Error(result.issue.message);
    }
    return result.graph;
}

export function parseSankeyTextDetailed(text: string, format: DataFormat): SankeyParseResult {
    const primary = format === "csv" ? parseCsv(text) : parseJson(text);
    if (primary.ok) return primary;

    const dslFallback = parseFlowDsl(text);
    if (dslFallback) {
        return dslFallback;
    }

    return primary;
}
