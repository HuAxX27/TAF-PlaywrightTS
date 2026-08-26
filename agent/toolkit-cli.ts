import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "./config";
import { classifyByHeuristics } from "./framework/classifyHeuristics";
import { buildFrameworkContext } from "./framework/context";
import { executeTest } from "./framework/e2eValidation";
import { explorePage } from "./framework/explore";
import { isAllowedSupportPath } from "./framework/fileBundle";
import { collectExistingTests } from "./framework/inventory";
import {
    loadKnowledge,
    mergeDistilled,
    renderKnowledgeMarkdown,
    saveKnowledge,
    type DistilledKnowledge,
} from "./framework/knowledge";
import { discoverCandidates, promoteCandidates } from "./framework/promotion";
import { validateGeneratedFiles } from "./framework/validate";
import { renderTestCasesMarkdown } from "./report";
import { createTestCaseSource } from "./sources";
import { findSecretLikeStrings, sanitizeForModel } from "./toolkit/learningSecurity";
import {
    captureWorkspaceSnapshot,
    changesSinceSnapshot,
    isCandidateSpecPath,
} from "./toolkit/workspaceSnapshot";
import type { TestCase, TestKind, XrayRunContext } from "./types";

type Flags = Map<string, string | true>;

interface SanitizedLearningInput {
    schemaVersion: 1;
    runDir: string;
    sanitizedAt: string;
    sourceFiles: string[];
    redactedValues: number;
    data: Record<string, unknown>;
}

const HELP = `
CLI determinista para el toolkit AQA de Claude Code

  npm run aqa:toolkit -- prepare --selector=<XRAY|keys:...|plan:...|jql:...>
  npm run aqa:toolkit -- snapshot --run-dir=agent/artifacts/<run-id>
  npm run aqa:toolkit -- fetch --selector=<XRAY|keys:...|plan:...|jql:...>
  npm run aqa:toolkit -- classify --test-cases=agent/artifacts/.../02-test-cases.json
  npm run aqa:toolkit -- inventory
  npm run aqa:toolkit -- context --kind=<ui|api>
  npm run aqa:toolkit -- explore --start-path=/ [--triggers=login,sign-in]
  npm run aqa:toolkit -- validate --spec=tests/candidates/... --run-dir=agent/artifacts/... [--support=a.ts,b.ts] [--e2e]
  npm run aqa:toolkit -- e2e --spec=tests/candidates/...
  npm run aqa:toolkit -- status
  npm run aqa:toolkit -- promote --paths=a.spec.ts,b.spec.ts --confirm
  npm run aqa:toolkit -- promote --all --confirm
  npm run aqa:toolkit -- knowledge-report
  npm run aqa:toolkit -- knowledge-sanitize --run-dir=agent/artifacts/<run-id>
  npm run aqa:toolkit -- knowledge-merge --input=agent/artifacts/.../distilled.json --session=<id>

Este CLI no llama modelos. Claude y sus subagentes se encargan del
razonamiento; este proceso conserva Xray, Playwright y las puertas de promocion
como operaciones reproducibles.
`;

async function main(): Promise<void> {
    const command = process.argv[2]?.trim().toLowerCase();
    const flags = parseFlags(process.argv.slice(3));

    switch (command) {
        case "prepare":
            await prepare(flags);
            return;
        case "snapshot":
            snapshot(flags);
            return;
        case "fetch":
            await fetchXray(flags);
            return;
        case "classify":
            classify(flags);
            return;
        case "inventory":
            printJson(collectExistingTests());
            return;
        case "context":
            frameworkContext(flags);
            return;
        case "explore":
            await explore(flags);
            return;
        case "validate":
            validate(flags);
            return;
        case "e2e":
            runE2E(flags);
            return;
        case "status":
            printJson(discoverCandidates().map(publicCandidate));
            return;
        case "promote":
            promote(flags);
            return;
        case "knowledge-report":
            console.log(renderKnowledgeMarkdown(loadKnowledge()));
            return;
        case "knowledge-sanitize":
            sanitizeKnowledgeInput(flags);
            return;
        case "knowledge-merge":
            mergeKnowledge(flags);
            return;
        case "help":
        case "--help":
        case "-h":
        case undefined:
            console.log(HELP);
            return;
        default:
            throw new Error(`Comando desconocido: ${command}\n${HELP}`);
    }
}

async function fetchXray(flags: Flags): Promise<void> {
    const selector = required(flags, "selector");
    const testCases = await createTestCaseSource().fetch(selector);
    printJson({ selector, testCases });
}

function classify(flags: Flags): void {
    const filePath = resolveJsonInput(required(flags, "test-cases"));
    const testCases = JSON.parse(fs.readFileSync(filePath, "utf-8")) as TestCase[];
    const resolved: Array<{
        testCaseId: string;
        kind: TestKind;
        confidence: number;
        rationale: string;
        decidedBy: "heuristic";
    }> = [];
    const ambiguous: TestCase[] = [];

    for (const testCase of testCases) {
        if (testCase.kind) {
            resolved.push({
                testCaseId: testCase.id,
                kind: testCase.kind,
                confidence: 100,
                rationale: "El Test Case de origen ya declara su tipo.",
                decidedBy: "heuristic",
            });
            continue;
        }
        const verdict = classifyByHeuristics(testCase);
        if (verdict) {
            resolved.push({ testCaseId: testCase.id, ...verdict, decidedBy: "heuristic" });
        } else {
            ambiguous.push(testCase);
        }
    }
    printJson({
        confidenceThreshold: agentConfig.kindConfidenceThreshold,
        resolved,
        ambiguous,
    });
}

function frameworkContext(flags: Flags): void {
    const rawKind = stringFlag(flags, "kind") || "ui";
    if (rawKind !== "ui" && rawKind !== "api") throw new Error("--kind debe ser ui o api.");
    printJson({ kind: rawKind, context: buildFrameworkContext(rawKind) });
}

async function prepare(flags: Flags): Promise<void> {
    const selector = required(flags, "selector");
    const workspaceSnapshot = captureWorkspaceSnapshot();
    const source = createTestCaseSource();
    const testCases = await source.fetch(selector);
    const runId = stringFlag(flags, "run-id") || createRunId(selector);
    const artifactsDir = path.join(agentConfig.artifactsDir, runId);
    const xray: XrayRunContext = {
        selector,
        label: testCases.length === 1 ? testCases[0].title : `Lote Xray: ${selector}`,
    };
    const inventory = collectExistingTests();

    fs.mkdirSync(artifactsDir, { recursive: true });
    writeJson(path.join(artifactsDir, "00-run.json"), {
        selector,
        startedAt: new Date().toISOString(),
        engine: "claude-code-toolkit",
        source: source.name,
        candidatesDir: relative(agentConfig.candidatesDir),
        policy: {
            kindConfidenceThreshold: agentConfig.kindConfidenceThreshold,
            maxE2ERepairAttempts: agentConfig.maxE2ERepairAttempts,
        },
    });
    writeJson(path.join(artifactsDir, "01-workspace-snapshot.json"), workspaceSnapshot);
    writeJson(path.join(artifactsDir, "02-test-cases.json"), testCases);
    fs.writeFileSync(
        path.join(artifactsDir, "02-test-cases.md"),
        renderTestCasesMarkdown(xray, testCases),
        "utf-8"
    );
    writeJson(path.join(artifactsDir, "03-inventory.json"), inventory.tests);

    printJson({
        ok: true,
        selector,
        source: source.name,
        runId,
        artifactsDir: relative(artifactsDir),
        testCaseCount: testCases.length,
        inventoryCount: inventory.tests.length,
        inventorySource: inventory.source,
        inventoryWarning: inventory.warning,
        policy: {
            kindConfidenceThreshold: agentConfig.kindConfidenceThreshold,
            maxE2ERepairAttempts: agentConfig.maxE2ERepairAttempts,
        },
    });
}

function snapshot(flags: Flags): void {
    const runDir = resolveRunDir(required(flags, "run-dir"), true);
    const outputPath = path.join(runDir, "01-workspace-snapshot.json");
    const workspaceSnapshot = captureWorkspaceSnapshot();
    writeJson(outputPath, workspaceSnapshot);
    printJson({ ok: true, runDir: relative(runDir), snapshot: relative(outputPath) });
}

async function explore(flags: Flags): Promise<void> {
    const startPath = stringFlag(flags, "start-path") || "/";
    const triggerPatterns = (stringFlag(flags, "triggers") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => new RegExp(escapeRegExp(value), "i"));

    printJson(await explorePage(startPath, triggerPatterns));
}

function validate(flags: Flags): void {
    const specPath = resolveSpec(required(flags, "spec"));
    const supportRelPaths = (stringFlag(flags, "support") || "")
        .split(",")
        .map((value) => normalize(value))
        .filter(Boolean);

    for (const supportPath of supportRelPaths) {
        if (!isAllowedSupportPath(supportPath)) {
            throw new Error(`Ruta de soporte no permitida: ${supportPath}`);
        }
    }

    const runDirFlag = stringFlag(flags, "run-dir");
    const touchedFiles = runDirFlag
        ? changesSinceSnapshot(path.join(resolveRunDir(runDirFlag), "01-workspace-snapshot.json"))
        : [];
    const changedSupportFiles = touchedFiles.filter(isAllowedSupportPath);
    const allSupportRelPaths = [...new Set([...supportRelPaths, ...changedSupportFiles])].sort();
    const supportPaths = allSupportRelPaths.map((value) => path.join(agentConfig.root, value));
    const unexpectedFiles = touchedFiles.filter(
        (file) => !isCandidateSpecPath(file) && !isAllowedSupportPath(file)
    );
    const workspaceGuard = {
        checked: Boolean(runDirFlag),
        touchedFiles,
        candidateFiles: touchedFiles.filter(isCandidateSpecPath),
        changedSupportFiles,
        unexpectedFiles,
        ok: runDirFlag ? unexpectedFiles.length === 0 : false,
        warning: runDirFlag
            ? undefined
            : "No se proporciono --run-dir; no se pudo comprobar el diff real contra la instantanea.",
    };
    const staticValidation = validateGeneratedFiles(specPath, supportPaths);
    const staticOk = staticValidation.ok && workspaceGuard.ok;
    const e2e = flags.has("e2e") && staticOk ? executeTest(specPath) : undefined;
    const result = {
        ok: staticOk && (e2e?.passed ?? true),
        spec: relative(specPath),
        supportFiles: allSupportRelPaths,
        staticValidation,
        workspaceGuard,
        e2eValidation: e2e
            ? {
                  executed: true,
                  passed: e2e.passed,
                  duration: e2e.duration,
                  errors: e2e.errors,
                  screenshots: e2e.screenshots.map(relativeIfInsideRoot),
                  traces: e2e.traces.map(relativeIfInsideRoot),
                  outputTail: `${e2e.stderr}\n${e2e.stdout}`.slice(-6_000),
              }
            : { executed: false, passed: null },
    };

    const outputPath = stringFlag(flags, "output");
    if (outputPath) {
        const absoluteOutput = resolveArtifactOutput(outputPath);
        writeJson(absoluteOutput, result);
    }

    printJson(result);
    if (!result.ok) process.exitCode = 1;
}

function runE2E(flags: Flags): void {
    const specPath = resolveSpec(required(flags, "spec"));
    const result = executeTest(specPath, stringFlag(flags, "test-name"));
    const output = {
        passed: result.passed,
        spec: relative(specPath),
        duration: result.duration,
        errors: result.errors,
        screenshots: result.screenshots.map(relativeIfInsideRoot),
        traces: result.traces.map(relativeIfInsideRoot),
        outputTail: `${result.stderr}\n${result.stdout}`.slice(-6_000),
    };
    printJson(output);
    if (!result.passed) process.exitCode = 1;
}

function mergeKnowledge(flags: Flags): void {
    const inputPath = resolveJsonInput(required(flags, "input"));
    const session = required(flags, "session");
    const distilled = JSON.parse(fs.readFileSync(inputPath, "utf-8")) as DistilledKnowledge;
    const secretPaths = findSecretLikeStrings(distilled);
    if (secretPaths.length > 0) {
        throw new Error(
            `El conocimiento contiene texto sensible en: ${secretPaths.join(", ")}. Se rechazo todo el merge.`
        );
    }
    const knowledge = loadKnowledge();
    const outcome = mergeDistilled(knowledge, distilled, session);
    saveKnowledge(knowledge);
    printJson({ ok: true, outcome });
}

function sanitizeKnowledgeInput(flags: Flags): void {
    const runDir = resolveRunDir(required(flags, "run-dir"));
    const sourceNames = [
        "00-run.json",
        "02-test-cases.json",
        "04-coverage.json",
        "05-generated.json",
        "06-final-validation.json",
        "07-human-review.json",
        "08-candidate-manifest.json",
    ];
    const sourceFiles = sourceNames.filter((name) => fs.existsSync(path.join(runDir, name)));
    const data: Record<string, unknown> = {};
    const state = { redactedValues: 0 };

    for (const name of sourceFiles) {
        const parsed = JSON.parse(fs.readFileSync(path.join(runDir, name), "utf-8")) as unknown;
        data[name] = sanitizeForModel(parsed, state);
    }

    const result: SanitizedLearningInput = {
        schemaVersion: 1,
        runDir: relative(runDir),
        sanitizedAt: new Date().toISOString(),
        sourceFiles,
        redactedValues: state.redactedValues,
        data,
    };
    const outputPath = path.join(runDir, "09-learning-input.json");
    writeJson(outputPath, result);
    printJson({
        ok: true,
        output: relative(outputPath),
        sourceFiles,
        redactedValues: state.redactedValues,
    });
}

function promote(flags: Flags): void {
    if (!flags.has("confirm")) {
        throw new Error(
            "La promocion requiere --confirm despues de revisar el status, el reporte y el diff."
        );
    }

    const candidates = discoverCandidates();
    const paths = flags.has("all")
        ? candidates
              .filter((candidate) => candidate.eligible)
              .map((candidate) => candidate.relativePath)
        : (stringFlag(flags, "paths") || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean);

    if (paths.length === 0) {
        throw new Error("No hay candidates elegibles o no se indico --paths.");
    }

    printJson({ ok: true, promoted: promoteCandidates(paths) });
}

function publicCandidate(candidate: ReturnType<typeof discoverCandidates>[number]): object {
    return {
        testCaseId: candidate.testCaseId,
        path: candidate.relativePath,
        status: candidate.status,
        e2ePassed: candidate.e2ePassed,
        supportFiles: candidate.supportFiles,
        eligible: candidate.eligible,
        reason: candidate.reason,
        manifestPath: candidate.manifestPath,
    };
}

function parseFlags(args: string[]): Flags {
    const flags: Flags = new Map();
    for (const arg of args) {
        if (!arg.startsWith("--")) continue;
        const separator = arg.indexOf("=");
        if (separator < 0) {
            flags.set(arg.slice(2), true);
        } else {
            flags.set(arg.slice(2, separator), arg.slice(separator + 1));
        }
    }
    return flags;
}

function required(flags: Flags, name: string): string {
    const value = stringFlag(flags, name);
    if (!value) throw new Error(`Falta --${name}=<valor>.`);
    return value;
}

function stringFlag(flags: Flags, name: string): string | undefined {
    const value = flags.get(name);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolveSpec(input: string): string {
    const absolute = resolveInsideRoot(input);
    if (!absolute.endsWith(".spec.ts"))
        throw new Error(`El spec debe terminar en .spec.ts: ${input}`);
    if (!fs.existsSync(absolute)) throw new Error(`No existe el spec: ${input}`);
    return absolute;
}

function resolveArtifactOutput(input: string): string {
    const absolute = resolveInsideRoot(input);
    const artifactsRoot = path.resolve(agentConfig.artifactsDir);
    const rel = path.relative(artifactsRoot, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel) || !absolute.endsWith(".json")) {
        throw new Error("--output debe ser un .json dentro de agent/artifacts/.");
    }
    return absolute;
}

function resolveJsonInput(input: string): string {
    const absolute = resolveInsideRoot(input);
    if (!absolute.endsWith(".json") || !fs.existsSync(absolute)) {
        throw new Error(`Se esperaba un JSON existente dentro del repositorio: ${input}`);
    }
    return absolute;
}

function resolveRunDir(input: string, create = false): string {
    const absolute = resolveInsideRoot(input);
    const artifactsRoot = path.resolve(agentConfig.artifactsDir);
    const rel = path.relative(artifactsRoot, absolute);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error("--run-dir debe estar dentro de agent/artifacts/.");
    }
    if (create) fs.mkdirSync(absolute, { recursive: true });
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isDirectory()) {
        throw new Error(`No existe el runDir: ${input}`);
    }
    return absolute;
}

function resolveInsideRoot(input: string): string {
    const absolute = path.resolve(agentConfig.root, input);
    const rel = path.relative(agentConfig.root, absolute);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`La ruta queda fuera del repositorio: ${input}`);
    }
    return absolute;
}

function createRunId(selector: string): string {
    const slug = selector
        .replace(/^(keys|plan|jql):/i, "$1-")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${slug || "xray"}-${stamp}`;
}

function writeJson(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value, null, 2));
}

function relative(filePath: string): string {
    return normalize(path.relative(agentConfig.root, filePath));
}

function relativeIfInsideRoot(filePath: string): string {
    const rel = path.relative(agentConfig.root, path.resolve(filePath));
    return rel.startsWith("..") || path.isAbsolute(rel) ? filePath : normalize(rel);
}

function normalize(value: string): string {
    return value.trim().replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
