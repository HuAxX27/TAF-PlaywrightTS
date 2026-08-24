import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";
import { run } from "./shell";

export interface E2EValidationResult {
    ok: boolean;
    attempts: number;
    testOutput: string;
    errors: TestError[];
    screenshots: string[];
    traces: string[];
}

export interface TestError {
    type: "timeout" | "assertion" | "locator" | "navigation" | "other";
    message: string;
    stack?: string;
    location?: {
        file: string;
        line: number;
        column: number;
    };
}

export interface TestExecutionOutput {
    passed: boolean;
    duration: number;
    errors: TestError[];
    stdout: string;
    stderr: string;
    screenshots: string[];
    traces: string[];
}

/**
 * Ejecuta un test de Playwright contra la aplicación real y captura
 * toda la información de diagnóstico necesaria para repararlo.
 */
export function executeTest(specPath: string, testName?: string): TestExecutionOutput {
    const specRel = toRelative(specPath);
    const testFilter = testName ? ` -g "${testName}"` : "";

    // Un solo navegador durante la reparacion: el objetivo es diagnosticar, no dar cobertura.
    const command = `npx playwright test "${specRel}"${testFilter} --project=chromium --reporter=json --output=test-results`;

    const result = run(command, {
        cwd: agentConfig.root,
        timeoutMs: 180_000,
        env: {
            PWTEST_TRACE: "on",
            PWTEST_SCREENSHOT: "on",
        },
    });

    const jsonOutput = extractJsonReport(result.stdout);
    const errors = parseTestErrors(`${result.stderr}\n${result.stdout}`, jsonOutput);
    const screenshots = findArtifacts(specRel, "png");
    const traces = findArtifacts(specRel, "zip");

    // Sin errores parseados pero con exit code != 0 no se puede diagnosticar nada:
    // se conserva la salida cruda como error para que el analizador tenga material.
    if (result.code !== 0 && errors.length === 0) {
        errors.push({
            type: "other",
            message: `Playwright termino con codigo ${result.code} sin errores parseables.\n${result.stdout.slice(-3000)}`,
        });
    }

    // Detectar errores que requieren acción humana
    const requiresHumanAction = errors.some(
        (err) =>
            err.message.includes("PENDIENTE") ||
            err.message.includes("<PENDIENTE") ||
            err.message.includes("Q-0") ||
            err.message.includes("TODO") ||
            err.message.includes("FIXME")
    );

    if (requiresHumanAction && errors.length > 0) {
        console.log(
            "\n       ⚠️  ERROR: El test requiere acción humana (URL pendiente, datos faltantes, etc.)"
        );
        console.log("       El test NO puede repararse automáticamente.");
        console.log("       Por favor, revisa el spec y completa la información faltante.\n");
    }

    return {
        passed: result.code === 0,
        duration: jsonOutput?.duration ?? 0,
        errors,
        stdout: result.stdout,
        stderr: result.stderr,
        screenshots,
        traces,
    };
}

/**
 * Ejecuta el test múltiples veces hasta que pase o se agoten los intentos.
 * Devuelve el resultado de la última ejecución.
 */
export function executeTestWithRetries(
    specPath: string,
    maxAttempts: number = 3,
    testName?: string
): E2EValidationResult {
    let lastResult: TestExecutionOutput | null = null;
    let attempts = 0;

    while (attempts < maxAttempts) {
        attempts++;
        console.log(`       ejecutando test (intento ${attempts}/${maxAttempts})...`);
        
        lastResult = executeTest(specPath, testName);

        if (lastResult.passed) {
            console.log(`       ✓ test pasó en intento ${attempts}`);
            return {
                ok: true,
                attempts,
                testOutput: lastResult.stdout,
                errors: [],
                screenshots: lastResult.screenshots,
                traces: lastResult.traces,
            };
        }

        console.log(`       ✗ test falló: ${lastResult.errors.length} error(es)`);
    }

    return {
        ok: false,
        attempts,
        testOutput: lastResult?.stdout ?? "",
        errors: lastResult?.errors ?? [],
        screenshots: lastResult?.screenshots ?? [],
        traces: lastResult?.traces ?? [],
    };
}

function toRelative(filePath: string): string {
    return path.relative(agentConfig.root, filePath).replace(/\\/g, "/");
}

interface PlaywrightResult {
    status: string;
    error?: { message?: string; stack?: string };
    errors?: Array<{ message?: string; stack?: string }>;
}

interface PlaywrightSuite {
    suites?: PlaywrightSuite[];
    specs?: Array<{
        tests?: Array<{ results?: PlaywrightResult[] }>;
    }>;
}

interface PlaywrightJsonReport extends PlaywrightSuite {
    duration?: number;
    errors?: Array<{ message?: string; stack?: string }>;
}

function extractJsonReport(stdout: string): PlaywrightJsonReport | null {
    try {
        // Buscar el JSON report en la salida
        const jsonMatch = stdout.match(/\{[\s\S]*"suites"[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]) as PlaywrightJsonReport;
        }
    } catch {
        // Ignorar errores de parsing
    }
    return null;
}

/** Los reporters de Playwright anidan un suite por cada test.describe, hay que recorrerlos en profundidad. */
function collectFailedResults(suite: PlaywrightSuite, out: PlaywrightResult[]): void {
    for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
            for (const result of test.results ?? []) {
                if (result.status !== "passed" && result.status !== "skipped") {
                    out.push(result);
                }
            }
        }
    }
    for (const child of suite.suites ?? []) {
        collectFailedResults(child, out);
    }
}

function parseTestErrors(rawOutput: string, jsonReport: PlaywrightJsonReport | null): TestError[] {
    const errors: TestError[] = [];

    if (jsonReport) {
        const failed: PlaywrightResult[] = [];
        collectFailedResults(jsonReport, failed);
        errors.push(...failed.map(parseErrorFromResult));

        // Errores de nivel raiz (config, import roto, worker caido).
        for (const topLevel of jsonReport.errors ?? []) {
            if (!topLevel.message) continue;
            errors.push({
                type: "other",
                message: topLevel.message,
                stack: topLevel.stack,
            });
        }
    }

    if (errors.length === 0 && rawOutput.trim()) {
        errors.push(...parseErrorsFromStderr(rawOutput));
    }

    return errors;
}

function parseErrorFromResult(result: PlaywrightResult): TestError {
    const error = result.error ?? result.errors?.[0] ?? {};
    const extra = (result.errors ?? [])
        .slice(1)
        .map((err) => err.message)
        .filter(Boolean)
        .join("\n---\n");
    const base = error.message ?? `Test ${result.status}`;
    const message = extra ? `${base}\n---\n${extra}` : base;
    const stack = error.stack;

    // Detectar tipo de error
    let type: TestError["type"] = "other";
    if (message.includes("Timeout") || result.status === "timedOut") {
        type = "timeout";
    } else if (message.includes("expect") || message.includes("assertion")) {
        type = "assertion";
    } else if (message.includes("locator") || message.includes("selector")) {
        type = "locator";
    } else if (message.includes("navigation") || message.includes("goto")) {
        type = "navigation";
    }

    // Extraer ubicación del error
    const location = extractLocation(stack);

    return { type, message, stack, location };
}

function parseErrorsFromStderr(stderr: string): TestError[] {
    const errors: TestError[] = [];
    const lines = stderr.split(/\r?\n/);

    let currentError: Partial<TestError> | null = null;
    let stackLines: string[] = [];

    for (const line of lines) {
        // Detectar inicio de error
        if (line.includes("Error:") || line.includes("TimeoutError:") || line.includes("Test timeout of")) {
            if (currentError) {
                currentError.stack = stackLines.join("\n");
                errors.push(currentError as TestError);
            }
            currentError = {
                type: /TimeoutError|Test timeout of/.test(line) ? "timeout" : "other",
                message: line.trim(),
            };
            stackLines = [line];
        } else if (currentError && line.trim().startsWith("at ")) {
            stackLines.push(line);
        }
    }

    if (currentError) {
        currentError.stack = stackLines.join("\n");
        errors.push(currentError as TestError);
    }

    return errors;
}

function extractLocation(stack?: string): TestError["location"] | undefined {
    if (!stack) return undefined;

    // Buscar patrón: at file:line:column
    const match = stack.match(/at\s+.*?\(([^:]+):(\d+):(\d+)\)/);
    if (match) {
        return {
            file: match[1],
            line: parseInt(match[2], 10),
            column: parseInt(match[3], 10),
        };
    }

    return undefined;
}

function findArtifacts(specRel: string, extension: string): string[] {
    const resultsDir = path.join(agentConfig.root, "test-results");
    if (!fs.existsSync(resultsDir)) return [];

    const artifacts: string[] = [];
    const specName = path.basename(specRel, ".spec.ts");

    try {
        const dirs = fs.readdirSync(resultsDir);
        for (const dir of dirs) {
            if (dir.includes(specName)) {
                const dirPath = path.join(resultsDir, dir);
                if (fs.statSync(dirPath).isDirectory()) {
                    const files = fs.readdirSync(dirPath);
                    for (const file of files) {
                        if (file.endsWith(`.${extension}`)) {
                            artifacts.push(path.join(dirPath, file));
                        }
                    }
                }
            }
        }
    } catch {
        // Ignorar errores de lectura
    }

    return artifacts;
}
