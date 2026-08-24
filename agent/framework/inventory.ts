import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { agentConfig } from "../config";
import type { ExistingTest } from "../types";
import { run } from "./shell";

interface PlaywrightListSpec {
    title: string;
    file?: string;
    line?: number;
    tags?: string[];
}

interface PlaywrightListSuite {
    title?: string;
    file?: string;
    specs?: PlaywrightListSpec[];
    suites?: PlaywrightListSuite[];
}

interface PlaywrightListReport {
    suites?: PlaywrightListSuite[];
}

export interface Inventory {
    tests: ExistingTest[];
    source: "playwright" | "regex";
    /** Motivo por el que se cayo al fallback, si aplica. */
    warning?: string;
}

/**
 * Inventario de lo que YA esta automatizado.
 *
 * La fuente de verdad es el propio Playwright (`test --list`): conoce los
 * titulos finales, los tags y el archivo real, cosa que un regex sobre el
 * codigo no puede garantizar. Si no corre, se degrada a un escaneo de texto en
 * vez de reportar "0 pruebas", que seria una mentira peligrosa: el agente
 * duplicaria todo lo que ya existe.
 */
export function collectExistingTests(): Inventory {
    const listed = listWithPlaywright();

    if (listed.tests) {
        return { tests: listed.tests, source: "playwright" };
    }

    return {
        tests: scanSpecFiles(agentConfig.testsDir),
        source: "regex",
        warning: listed.reason,
    };
}

function listWithPlaywright(): { tests: ExistingTest[] | null; reason?: string } {
    // Pedirle el JSON por archivo y no por stdout evita que cualquier linea que
    // impriman dotenv, npx o un plugin del config corrompa el parseo.
    const outputFile = path.join(os.tmpdir(), `pw-list-${process.pid}-${Date.now()}.json`);

    const result = run("npx playwright test --list --pass-with-no-tests --reporter=json", {
        cwd: agentConfig.root,
        env: { PLAYWRIGHT_JSON_OUTPUT_NAME: outputFile },
    });

    let raw: string | null = null;

    try {
        if (fs.existsSync(outputFile)) {
            raw = fs.readFileSync(outputFile, "utf-8");
            fs.unlinkSync(outputFile);
        }
    } catch {
        raw = null;
    }

    if (!raw) {
        // Plan B: algunas versiones ignoran la variable y escriben a stdout.
        const start = result.stdout.indexOf("{");
        const end = result.stdout.lastIndexOf("}");
        if (start !== -1 && end > start) {
            raw = result.stdout.slice(start, end + 1);
        }
    }

    if (!raw) {
        const detail = firstMeaningfulLine(result.stderr) || firstMeaningfulLine(result.stdout);
        return {
            tests: null,
            reason: `playwright test --list salio con codigo ${result.code}${detail ? `: ${detail}` : ""}`,
        };
    }

    try {
        return { tests: parseListReport(JSON.parse(raw) as PlaywrightListReport) };
    } catch (error) {
        return {
            tests: null,
            reason: `no se pudo parsear el reporte: ${(error as Error).message}`,
        };
    }
}

function parseListReport(report: PlaywrightListReport): ExistingTest[] {
    const tests: ExistingTest[] = [];
    const seen = new Set<string>();

    const walk = (suite: PlaywrightListSuite, file: string, titlePath: string[]) => {
        const currentFile = suite.file ?? file;
        // El suite de primer nivel se titula con el archivo; no aporta al titulo.
        const trail =
            suite.title && suite.title !== currentFile ? [...titlePath, suite.title] : titlePath;

        for (const spec of suite.specs ?? []) {
            const specFile = spec.file ?? currentFile;
            const fullTitle = [...trail, spec.title].join(" > ");
            const dedupeKey = `${specFile}::${fullTitle}`;

            // El mismo spec aparece una vez por proyecto (chromium/firefox/webkit).
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);

            tests.push({
                title: fullTitle,
                file: normalizeFile(specFile),
                line: spec.line,
                tags: spec.tags?.length ? spec.tags : extractTags(fullTitle),
            });
        }

        for (const child of suite.suites ?? []) {
            walk(child, currentFile, trail);
        }
    };

    for (const suite of report.suites ?? []) {
        walk(suite, suite.file ?? "", []);
    }

    return tests;
}

/** Plan C: leer los .spec.ts y sacar titulos y tags a mano. */
export function scanSpecFiles(dir: string): ExistingTest[] {
    const tests: ExistingTest[] = [];
    if (!fs.existsSync(dir)) return tests;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            tests.push(...scanSpecFiles(fullPath));
            continue;
        }
        if (!entry.name.endsWith(".spec.ts")) continue;

        const content = fs.readFileSync(fullPath, "utf-8");
        const regex = /\btest(?:\.describe)?\(\s*[`'"]([^`'"]+)[`'"]([\s\S]{0,200}?)\)/g;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const tagBlock = match[2].match(/tag:\s*\[([^\]]*)\]/)?.[1] ?? "";
            tests.push({
                title: match[1],
                file: normalizeFile(path.relative(agentConfig.root, fullPath)),
                line: content.slice(0, match.index).split("\n").length,
                tags: tagBlock.match(/@[\w-]+/g) ?? extractTags(match[1]),
            });
        }
    }

    return tests;
}

function extractTags(title: string): string[] {
    return title.match(/@[\w-]+/g) ?? [];
}

function firstMeaningfulLine(output: string): string {
    return (
        output
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.length > 0) ?? ""
    ).slice(0, 200);
}

function normalizeFile(file: string): string {
    const separator = String.fromCharCode(92);
    return file.split(separator).join("/");
}
