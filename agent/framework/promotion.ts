import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";
import { validateGeneratedFiles } from "./validate";

type CandidateStatus = "ready_for_review" | "coverage_incomplete" | "needs_repair" | "unknown";

interface ManifestEntry {
    testCaseId?: string;
    candidate?: string;
    status?: CandidateStatus;
    supportFiles?: string[];
    e2ePassed?: boolean | null;
}

interface ManifestRecord extends ManifestEntry {
    manifestPath: string;
    modifiedAt: number;
}

interface CandidateInfo {
    testCaseId: string;
    relativePath: string;
    absolutePath: string;
    status: CandidateStatus;
    e2ePassed: boolean | null;
    supportFiles: string[];
    manifestPath?: string;
    eligible: boolean;
    reason?: string;
}

interface PromotedCandidate {
    testCaseId: string;
    source: string;
    target: string;
}

interface PromotionOperation {
    candidate: CandidateInfo;
    sourcePath: string;
    targetPath: string;
    sourceContent: string;
    targetContent: string;
}

/** Lista candidates y enlaza cada uno con su manifest mas reciente. */
export function discoverCandidates(): CandidateInfo[] {
    const manifestByCandidate = loadLatestManifestEntries();
    const files = walkFiles(agentConfig.candidatesDir).filter((file) => file.endsWith(".spec.ts"));

    return files
        .map((absolutePath): CandidateInfo => {
            const relativePath = normalize(path.relative(agentConfig.root, absolutePath));
            const manifest = manifestByCandidate.get(relativePath.toLowerCase());
            const status = manifest?.status ?? "unknown";
            const e2ePassed = manifest?.e2ePassed ?? null;
            const reason = eligibilityReason(status, e2ePassed, manifest);

            return {
                testCaseId: manifest?.testCaseId?.trim() || testCaseIdFromPath(relativePath),
                relativePath,
                absolutePath,
                status,
                e2ePassed,
                supportFiles: (manifest?.supportFiles ?? []).map(normalize),
                manifestPath: manifest?.manifestPath,
                eligible: reason === undefined,
                reason,
            };
        })
        .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/**
 * Promueve un lote como una sola operacion: todos pasan preflight y validacion,
 * o se revierte cada archivo a candidates.
 */
export function promoteCandidates(candidatePaths: string[]): PromotedCandidate[] {
    const requested = [...new Set(candidatePaths.map(resolveCandidateInput))];
    if (requested.length === 0) throw new Error("No se seleccionaron candidates para promover.");

    const byPath = new Map(
        discoverCandidates().map((candidate) => [candidate.relativePath.toLowerCase(), candidate])
    );
    const selectedCandidates = requested.map((relativePath) => {
        const candidate = byPath.get(relativePath.toLowerCase());
        if (!candidate) throw new Error(`No existe el candidate: ${relativePath}`);
        return candidate;
    });

    // El preflight se completa para todo el lote antes de mover el primer archivo.
    const blocked = selectedCandidates.filter((candidate) => !candidate.eligible);
    if (blocked.length > 0) {
        throw new Error(
            [
                "La promocion fue cancelada; hay candidates que no estan listos:",
                ...blocked.map(
                    (candidate) =>
                        `- ${candidate.relativePath}: ${candidate.reason ?? candidate.status}`
                ),
            ].join("\n")
        );
    }
    const operations = selectedCandidates.map(prepareOperation);

    for (const operation of operations) {
        const supportPaths = operation.candidate.supportFiles.map((file) =>
            path.join(agentConfig.root, file)
        );
        const validation = validateGeneratedFiles(operation.sourcePath, supportPaths);
        if (!validation.ok) {
            throw new Error(
                `El candidate ${operation.candidate.relativePath} ya no pasa validacion:\n${validation.errors.join("\n")}`
            );
        }
    }

    const completed: PromotionOperation[] = [];
    try {
        for (const operation of operations) {
            fs.mkdirSync(path.dirname(operation.targetPath), { recursive: true });
            fs.renameSync(operation.sourcePath, operation.targetPath);
            fs.writeFileSync(operation.targetPath, operation.targetContent, "utf-8");

            const supportPaths = operation.candidate.supportFiles.map((file) =>
                path.join(agentConfig.root, file)
            );
            const validation = validateGeneratedFiles(operation.targetPath, supportPaths);
            if (!validation.ok) {
                throw new Error(
                    `El spec promovido ${toRootRelative(operation.targetPath)} fallo la validacion:\n${validation.errors.join("\n")}`
                );
            }
            completed.push(operation);
        }
    } catch (error) {
        rollback([...completed, ...operations.filter((item) => !completed.includes(item))]);
        throw error;
    }

    const promoted = completed.map((operation) => ({
        testCaseId: operation.candidate.testCaseId,
        source: operation.candidate.relativePath,
        target: toRootRelative(operation.targetPath),
    }));
    writePromotionAudit(promoted);
    return promoted;
}

function prepareOperation(candidate: CandidateInfo): PromotionOperation {
    const relativeInsideCandidates = normalize(
        path.relative(agentConfig.candidatesDir, candidate.absolutePath)
    );
    if (
        relativeInsideCandidates.startsWith("../") ||
        !/^(ui|api)\/[A-Za-z0-9._/-]+\.spec\.ts$/.test(relativeInsideCandidates)
    ) {
        throw new Error(`Ruta de candidate invalida: ${candidate.relativePath}`);
    }

    const targetPath = path.resolve(agentConfig.testsDir, relativeInsideCandidates);
    const testsRoot = path.resolve(agentConfig.testsDir);
    if (!targetPath.startsWith(`${testsRoot}${path.sep}`)) {
        throw new Error(`El destino queda fuera de tests/: ${candidate.relativePath}`);
    }
    if (fs.existsSync(targetPath)) {
        throw new Error(`Ya existe el spec aprobado: ${toRootRelative(targetPath)}`);
    }

    const sourceContent = fs.readFileSync(candidate.absolutePath, "utf-8");
    if (/\bTODO\b|\bPENDIENTE\b|test\.fixme\s*\(|waitForTimeout\s*\(/i.test(sourceContent)) {
        throw new Error(`${candidate.relativePath} contiene placeholders o patrones prohibidos.`);
    }

    return {
        candidate,
        sourcePath: candidate.absolutePath,
        targetPath,
        sourceContent,
        targetContent: promotedContent(sourceContent, candidate.absolutePath, targetPath),
    };
}

function promotedContent(content: string, sourcePath: string, targetPath: string): string {
    const sourceImport = fixtureImport(path.dirname(sourcePath));
    const targetImport = fixtureImport(path.dirname(targetPath));
    const importPattern = new RegExp(`(from\\s+["'])${escapeRegExp(sourceImport)}(["'])`, "g");

    if (!importPattern.test(content)) {
        throw new Error(
            `No se encontro el import esperado del fixture (${sourceImport}) en ${toRootRelative(sourcePath)}.`
        );
    }

    return content
        .replace(importPattern, `$1${targetImport}$2`)
        .replace(
            "// Candidate generado por el Agente AQA - no ejecutar en regresion hasta promoverlo.",
            "// Generado por el Agente AQA - promovido tras validacion y revision humana."
        );
}

function fixtureImport(fromDir: string): string {
    const relative = normalize(path.relative(fromDir, agentConfig.fixturesPath)).replace(
        /\.ts$/,
        ""
    );
    return relative.startsWith(".") ? relative : `./${relative}`;
}

function rollback(operations: PromotionOperation[]): void {
    for (const operation of [...operations].reverse()) {
        try {
            if (fs.existsSync(operation.targetPath) && !fs.existsSync(operation.sourcePath)) {
                fs.mkdirSync(path.dirname(operation.sourcePath), { recursive: true });
                fs.renameSync(operation.targetPath, operation.sourcePath);
            }
            if (fs.existsSync(operation.sourcePath)) {
                fs.writeFileSync(operation.sourcePath, operation.sourceContent, "utf-8");
            }
        } catch (rollbackError) {
            console.error(
                `No se pudo revertir ${operation.candidate.relativePath}: ${String(rollbackError)}`
            );
        }
    }
}

function eligibilityReason(
    status: CandidateStatus,
    e2ePassed: boolean | null,
    manifest: ManifestRecord | undefined
): string | undefined {
    if (!manifest) return "sin manifest de validacion";
    if (status === "coverage_incomplete") return "cobertura del TC incompleta";
    if (status === "needs_repair") return "requiere reparacion";
    if (status !== "ready_for_review") return `estado no promovible: ${status}`;
    if (e2ePassed !== true) return "la validacion E2E no esta aprobada";
    return undefined;
}

function loadLatestManifestEntries(): Map<string, ManifestRecord> {
    const records = new Map<string, ManifestRecord>();
    for (const manifestPath of walkFiles(agentConfig.artifactsDir).filter((file) =>
        file.endsWith(`${path.sep}08-candidate-manifest.json`)
    )) {
        try {
            const modifiedAt = fs.statSync(manifestPath).mtimeMs;
            const entries = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ManifestEntry[];
            for (const entry of entries) {
                if (!entry.candidate) continue;
                const key = normalize(entry.candidate).toLowerCase();
                const previous = records.get(key);
                if (!previous || modifiedAt > previous.modifiedAt) {
                    records.set(key, {
                        ...entry,
                        manifestPath: toRootRelative(manifestPath),
                        modifiedAt,
                    });
                }
            }
        } catch {
            // Un manifest historico corrupto no bloquea la lectura de los demas.
        }
    }
    return records;
}

function walkFiles(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    const files: string[] = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(fullPath));
        else if (entry.isFile()) files.push(fullPath);
    }
    return files;
}

function resolveCandidateInput(input: string): string {
    const absolutePath = path.resolve(agentConfig.root, input.trim());
    const relativePath = toRootRelative(absolutePath);
    const candidateRoot = `${normalize(path.relative(agentConfig.root, agentConfig.candidatesDir))}/`;
    if (!relativePath.toLowerCase().startsWith(candidateRoot.toLowerCase())) {
        throw new Error(`La ruta no esta dentro de ${candidateRoot}: ${input}`);
    }
    return relativePath;
}

function writePromotionAudit(promoted: PromotedCandidate[]): void {
    const auditDir = path.join(agentConfig.artifactsDir, "promotions");
    fs.mkdirSync(auditDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.writeFileSync(
        path.join(auditDir, `${stamp}.json`),
        `${JSON.stringify({ promotedAt: new Date().toISOString(), promoted }, null, 2)}\n`,
        "utf-8"
    );
}

function testCaseIdFromPath(file: string): string {
    return path.basename(file, ".spec.ts").split("-").slice(0, 2).join("-").toUpperCase();
}

function toRootRelative(file: string): string {
    return normalize(path.relative(agentConfig.root, file));
}

function normalize(value: string): string {
    return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
