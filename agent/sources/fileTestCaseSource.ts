import * as fs from "fs";
import * as path from "path";
import type { TestCase } from "../types";
import type { TestCaseSource } from "./testCaseSource";

/**
 * Lee test cases ya definidos de `agent/testcases/<KEY>.json` o `<KEY>.csv`.
 * El .json acepta un TestCase suelto o un array (varios TCs de un mismo Test Set).
 * El .csv es el export nativo de Xray (columnas Action, Data, Expected Result).
 */
export class FileTestCaseSource implements TestCaseSource {
    readonly name = "file";

    constructor(private readonly testCaseDir: string) {}

    async fetch(key: string): Promise<TestCase[]> {
        const jsonPath = path.join(this.testCaseDir, `${key}.json`);
        if (fs.existsSync(jsonPath)) {
            const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as unknown;
            const items = (Array.isArray(raw) ? raw : [raw]) as Partial<TestCase>[];
            return items.map((item, index) => normalizeTestCase(item, key, index));
        }

        const csvPath = path.join(this.testCaseDir, `${key}.csv`);
        if (fs.existsSync(csvPath)) {
            return [testCaseFromXrayCsv(key, fs.readFileSync(csvPath, "utf-8"))];
        }

        throw new Error(
            `No encontre test cases definidos para "${key}". Crea ${jsonPath} o ${csvPath} ` +
                `(export de Xray), o usa --source=xray si ya tienes credenciales configuradas.`
        );
    }
}

/** Convierte el export CSV de Xray (Action, Data, Expected Result) a un TestCase. */
export function testCaseFromXrayCsv(key: string, csv: string): TestCase {
    const rows = parseCsv(csv);
    if (rows.length === 0) {
        throw new Error(`El CSV de "${key}" no tiene filas.`);
    }

    const [header, ...dataRows] = rows;
    const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
    const actionIdx = col("action");
    const dataIdx = col("data");
    const resultIdx = col("expected result");

    const steps = dataRows
        .map((row) => [row[actionIdx]?.trim(), row[dataIdx]?.trim()].filter(Boolean).join(" - "))
        .filter(Boolean);

    const expectedResult = dataRows
        .map((row) => row[resultIdx]?.trim())
        .filter(Boolean)
        .join(" | ");

    return {
        id: key,
        title: key,
        level: "e2e",
        priority: "medium",
        tags: [],
        preconditions: [],
        steps,
        expectedResult,
        automatable: true,
    };
}

/** Parser CSV minimo: comillas, comas y comillas escapadas ("") dentro de un campo. */
function parseCsv(text: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = "";
    let inQuotes = false;

    const lines = text.replace(/\r\n/g, "\n").split("\n");
    for (const line of lines) {
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (inQuotes) {
                if (char === '"' && line[i + 1] === '"') {
                    field += '"';
                    i++;
                } else if (char === '"') {
                    inQuotes = false;
                } else {
                    field += char;
                }
            } else if (char === '"') {
                inQuotes = true;
            } else if (char === ",") {
                row.push(field);
                field = "";
            } else {
                field += char;
            }
        }

        if (inQuotes) {
            field += "\n";
            continue;
        }

        row.push(field);
        field = "";
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
        row = [];
    }

    return rows;
}

function normalizeTestCase(item: Partial<TestCase>, key: string, index: number): TestCase {
    return {
        id: item.id?.trim() || `${key}-${String(index + 1).padStart(2, "0")}`,
        title: item.title?.trim() || key,
        level: item.level ?? "e2e",
        priority: item.priority ?? "medium",
        tags: (item.tags ?? []).map((tag) => (tag.startsWith("@") ? tag : `@${tag}`)),
        preconditions: item.preconditions ?? [],
        steps: item.steps ?? [],
        expectedResult: item.expectedResult?.trim() ?? "",
        automatable: item.automatable !== false,
        notAutomatableReason: item.notAutomatableReason?.trim() || undefined,
    };
}
