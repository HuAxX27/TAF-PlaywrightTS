import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "./config";
import { buildFrameworkContext } from "./framework/context";
import { explorePage } from "./framework/explore";
import { isAllowedSupportPath, parseFileBundle, type FileEntry } from "./framework/fileBundle";
import { collectExistingTests } from "./framework/inventory";
import { validateGeneratedFiles } from "./framework/validate";
import { createProvider, extractJson, type LlmProvider } from "./llm";
import {
    codegenPrompt,
    coveragePrompt,
    repairPrompt,
    SYSTEM_PROMPT,
    testCasesPrompt,
    type CodegenContext,
} from "./prompts";
import { createStorySource, createTestCaseSource } from "./sources";
import { renderCoverageMarkdown, renderReport, renderTestCasesMarkdown } from "./report";
import type {
    AgentRunResult,
    CoverageItem,
    ExistingTest,
    GeneratedSpec,
    TestCase,
    UserStory,
} from "./types";

/** "story": disena TCs desde una User Story. "testcase": el TC ya viene definido (p.ej. Xray). */
export type RunMode = "story" | "testcase";

export interface RunOptions {
    storyKey: string;
    provider?: string;
    source?: string;
    mode?: RunMode;
    /** Analiza y reporta, pero no escribe ningun spec. */
    dryRun?: boolean;
    /** Tambien genera codigo para los test cases marcados como "partial". */
    includePartial?: boolean;
}

export async function runAgent(options: RunOptions): Promise<AgentRunResult> {
    return (options.mode ?? "story") === "testcase"
        ? runFromTestCases(options)
        : runFromStory(options);
}

async function runFromStory(options: RunOptions): Promise<AgentRunResult> {
    const provider = createProvider(options.provider);
    const source = createStorySource(options.source);
    const artifactsDir = path.join(agentConfig.artifactsDir, options.storyKey);

    fs.mkdirSync(artifactsDir, { recursive: true });

    console.log(`\nAgente AQA  |  historia: ${options.storyKey}`);
    console.log(`   proveedor: ${provider.name} (${provider.model})   origen: ${source.name}\n`);

    // --- 1. User Story -------------------------------------------------------
    console.log("1/5  Leyendo la User Story...");
    const story = await source.fetch(options.storyKey);
    writeJson(path.join(artifactsDir, "01-user-story.json"), story);
    console.log(
        `     "${story.title}" - ${story.acceptanceCriteria.length} criterios de aceptacion`
    );

    if (story.acceptanceCriteria.length === 0) {
        console.warn(
            "     ! No se detectaron criterios de aceptacion; los test cases seran mas debiles."
        );
    }

    // --- 2. Test Cases -------------------------------------------------------
    console.log("2/5  Disenando test cases a partir de la historia...");
    const testCases = await generateTestCases(provider, story);
    writeJson(path.join(artifactsDir, "02-test-cases.json"), testCases);
    fs.writeFileSync(
        path.join(artifactsDir, "02-test-cases.md"),
        renderTestCasesMarkdown(story, testCases),
        "utf-8"
    );
    console.log(`     ${testCases.length} test cases propuestos`);

    // --- 3. Inventario del framework ----------------------------------------
    console.log("3/5  Inventariando las pruebas que ya existen...");
    const { tests: inventory, source: inventorySource, warning } = collectExistingTests();
    writeJson(path.join(artifactsDir, "03-inventory.json"), inventory);

    if (warning) {
        console.warn(`     ! ${warning}`);
        console.warn("     ! se usara un escaneo de texto de los .spec.ts (menos preciso)");
    }
    console.log(`     ${inventory.length} pruebas existentes (via ${inventorySource})`);

    // --- 4. Analisis de cobertura -------------------------------------------
    console.log("4/5  Comparando test cases contra la cobertura actual...");
    const coverage = await analyzeCoverage(provider, testCases, inventory);
    writeJson(path.join(artifactsDir, "04-coverage.json"), coverage);
    fs.writeFileSync(
        path.join(artifactsDir, "04-coverage.md"),
        renderCoverageMarkdown(testCases, coverage),
        "utf-8"
    );

    const byStatus = (status: string) => coverage.filter((item) => item.status === status).length;
    console.log(
        `     cubiertos: ${byStatus("covered")}  |  parciales: ${byStatus("partial")}  |  faltantes: ${byStatus("missing")}`
    );

    // --- 5. Generacion de codigo --------------------------------------------
    const pending = selectPending(testCases, coverage, options.includePartial ?? false);
    let generated: GeneratedSpec[] = [];

    if (options.dryRun) {
        console.log(
            `5/5  --dry-run: no se escribe codigo (${pending.length} specs quedarian por generar)`
        );
    } else if (pending.length === 0) {
        console.log(
            "5/5  Nada que generar: la historia ya esta cubierta por las pruebas actuales."
        );
    } else {
        console.log(`5/5  Generando ${pending.length} specs...`);
        generated = await generateSpecs(provider, pending);
    }

    const result: AgentRunResult = {
        story,
        testCases,
        inventory,
        coverage,
        generated,
        artifactsDir,
    };
    fs.writeFileSync(
        path.join(artifactsDir, "05-report.md"),
        renderReport(result, provider),
        "utf-8"
    );

    return result;
}

/** TC ya definido (p.ej. en Xray) -> spec directo, sin redisenar nada con el LLM. */
async function runFromTestCases(options: RunOptions): Promise<AgentRunResult> {
    const provider = createProvider(options.provider);
    const source = createTestCaseSource(options.source);
    const artifactsDir = path.join(agentConfig.artifactsDir, options.storyKey);

    fs.mkdirSync(artifactsDir, { recursive: true });

    console.log(`\nAgente AQA  |  test case: ${options.storyKey}`);
    console.log(`   proveedor: ${provider.name} (${provider.model})   origen: ${source.name}\n`);

    // --- 1. Test cases ya definidos ------------------------------------------
    console.log("1/4  Leyendo el/los test case(s) definidos...");
    const testCases = await source.fetch(options.storyKey);
    const story: UserStory = {
        key: options.storyKey,
        title: testCases.length === 1 ? testCases[0].title : options.storyKey,
        description: "",
        acceptanceCriteria: [],
        labels: [],
    };
    writeJson(path.join(artifactsDir, "02-test-cases.json"), testCases);
    fs.writeFileSync(
        path.join(artifactsDir, "02-test-cases.md"),
        renderTestCasesMarkdown(story, testCases),
        "utf-8"
    );
    console.log(`     ${testCases.length} test case(s) importados de ${source.name}`);

    // --- 2. Inventario del framework ------------------------------------------
    console.log("2/4  Inventariando las pruebas que ya existen...");
    const { tests: inventory, source: inventorySource, warning } = collectExistingTests();
    writeJson(path.join(artifactsDir, "03-inventory.json"), inventory);

    if (warning) {
        console.warn(`     ! ${warning}`);
        console.warn("     ! se usara un escaneo de texto de los .spec.ts (menos preciso)");
    }
    console.log(`     ${inventory.length} pruebas existentes (via ${inventorySource})`);

    // --- 3. Analisis de cobertura -----------------------------------------
    console.log("3/4  Comparando el test case contra la cobertura actual...");
    const coverage = await analyzeCoverage(provider, testCases, inventory);
    writeJson(path.join(artifactsDir, "04-coverage.json"), coverage);
    fs.writeFileSync(
        path.join(artifactsDir, "04-coverage.md"),
        renderCoverageMarkdown(testCases, coverage),
        "utf-8"
    );

    const byStatus = (status: string) => coverage.filter((item) => item.status === status).length;
    console.log(
        `     cubiertos: ${byStatus("covered")}  |  parciales: ${byStatus("partial")}  |  faltantes: ${byStatus("missing")}`
    );

    // --- 4. Generacion de codigo ---------------------------------------------
    const pending = selectPending(testCases, coverage, options.includePartial ?? false);
    let generated: GeneratedSpec[] = [];

    if (options.dryRun) {
        console.log(
            `4/4  --dry-run: no se escribe codigo (${pending.length} specs quedarian por generar)`
        );
    } else if (pending.length === 0) {
        console.log("4/4  Nada que generar: el test case ya esta cubierto por las pruebas actuales.");
    } else {
        console.log(`4/4  Generando ${pending.length} specs...`);
        generated = await generateSpecs(provider, pending);
    }

    const result: AgentRunResult = {
        story,
        testCases,
        inventory,
        coverage,
        generated,
        artifactsDir,
    };
    fs.writeFileSync(
        path.join(artifactsDir, "05-report.md"),
        renderReport(result, provider),
        "utf-8"
    );

    return result;
}

async function generateTestCases(provider: LlmProvider, story: UserStory): Promise<TestCase[]> {
    const raw = await provider.complete({
        system: SYSTEM_PROMPT,
        prompt: testCasesPrompt(story),
    });

    return extractJson<Partial<TestCase>[]>(raw).map((testCase, index) => ({
        id: testCase.id?.trim() || `TC-${String(index + 1).padStart(2, "0")}`,
        title: testCase.title?.trim() || `Escenario ${index + 1}`,
        level: testCase.level ?? "e2e",
        priority: testCase.priority ?? "medium",
        tags: normalizeTags(testCase.tags),
        preconditions: testCase.preconditions ?? [],
        steps: testCase.steps ?? [],
        expectedResult: testCase.expectedResult?.trim() || "",
        automatable: testCase.automatable !== false,
        notAutomatableReason: testCase.notAutomatableReason?.trim() || undefined,
    }));
}

async function analyzeCoverage(
    provider: LlmProvider,
    testCases: TestCase[],
    inventory: ExistingTest[]
): Promise<CoverageItem[]> {
    const raw = await provider.complete({
        system: SYSTEM_PROMPT,
        prompt: coveragePrompt(testCases, inventory),
    });

    const parsed = extractJson<Partial<CoverageItem>[]>(raw);
    const byId = new Map(parsed.map((item) => [item.testCaseId, item]));

    // Un test case sin veredicto se trata como faltante: preferimos revisar un
    // spec de mas que perder cobertura por una respuesta incompleta del modelo.
    return testCases.map((testCase) => {
        const item = byId.get(testCase.id);
        return {
            testCaseId: testCase.id,
            status: item?.status ?? "missing",
            matchedTests: item?.matchedTests ?? [],
            rationale: item?.rationale ?? "El modelo no emitio veredicto; se asume no cubierto.",
        };
    });
}

function selectPending(
    testCases: TestCase[],
    coverage: CoverageItem[],
    includePartial: boolean
): TestCase[] {
    const wanted = new Set<string>(
        coverage
            .filter(
                (item) => item.status === "missing" || (includePartial && item.status === "partial")
            )
            .map((item) => item.testCaseId)
    );

    return testCases.filter((testCase) => {
        if (!wanted.has(testCase.id)) return false;
        if (!testCase.automatable) {
            console.log(
                `     - ${testCase.id} omitido (no automatizable): ${testCase.notAutomatableReason ?? ""}`
            );
            return false;
        }
        return true;
    });
}

async function generateSpecs(provider: LlmProvider, pending: TestCase[]): Promise<GeneratedSpec[]> {
    const frameworkContext = buildFrameworkContext();
    const results: GeneratedSpec[] = [];

    for (const testCase of pending) {
        const moduleDir = path.join(agentConfig.testsDir, moduleForTestCase(testCase));
        fs.mkdirSync(moduleDir, { recursive: true });

        const fileName = specFileName(testCase);
        const filePath = path.join(moduleDir, fileName);
        const specRelPath = path.relative(agentConfig.root, filePath).replace(/\\/g, "/");
        const importPath = fixtureImportPath(moduleDir);

        console.log(`     - ${testCase.id} ${testCase.title}`);

        const exploration = await explorePage("/", explorationTriggersFor(testCase));
        if (exploration.warning) {
            console.log(`       ! exploracion en vivo fallo: ${exploration.warning}`);
        } else if (exploration.triggeredAction) {
            console.log(`       exploracion: click en "${exploration.triggeredAction}"`);
        }

        const context: CodegenContext = {
            frameworkContext,
            importPath,
            specRelPath,
            pageExploration: exploration.warning ? undefined : exploration.ariaSnapshot,
            explorationWarning: exploration.warning,
        };

        // Guarda el contenido previo de cualquier archivo de soporte que el modelo
        // toque, para poder revertirlo si el bundle final no pasa la validacion.
        const originalSupportContent = new Map<string, string | undefined>();
        const trackOriginal = (relPath: string) => {
            if (!originalSupportContent.has(relPath)) {
                originalSupportContent.set(relPath, readIfExists(path.join(agentConfig.root, relPath)));
            }
        };

        let bundle = parseFileBundle(
            await provider.complete({ system: SYSTEM_PROMPT, prompt: codegenPrompt(testCase, context) }),
            specRelPath
        );
        bundle.supportFiles.forEach((file) => trackOriginal(file.path));
        writeBundle(filePath, bundle);

        let validation = validateGeneratedFiles(
            filePath,
            bundle.supportFiles.map((file) => path.join(agentConfig.root, file.path))
        );
        let attempts = 1;

        while (!validation.ok && attempts <= agentConfig.maxRepairAttempts) {
            console.log(
                `       validacion fallida, reparacion ${attempts}/${agentConfig.maxRepairAttempts}`
            );
            const currentFiles: FileEntry[] = [
                { path: specRelPath, content: bundle.specContent },
                ...bundle.supportFiles,
            ];
            bundle = parseFileBundle(
                await provider.complete({
                    system: SYSTEM_PROMPT,
                    prompt: repairPrompt(currentFiles, validation.errors, context),
                }),
                specRelPath
            );
            bundle.supportFiles.forEach((file) => trackOriginal(file.path));
            writeBundle(filePath, bundle);
            validation = validateGeneratedFiles(
                filePath,
                bundle.supportFiles.map((file) => path.join(agentConfig.root, file.path))
            );
            attempts++;
        }

        let finalPath = filePath;

        if (!validation.ok) {
            // Un spec roto dentro de tests/ deja la suite en rojo para todo el
            // equipo. Se conserva para revision, pero fuera del alcance de Playwright.
            // Los archivos de soporte se revierten para no dejar el framework roto.
            for (const [relPath, original] of originalSupportContent) {
                restoreSupportFile(path.join(agentConfig.root, relPath), original);
            }
            finalPath = `${filePath}.invalid`;
            fs.renameSync(filePath, finalPath);
            console.log(
                "       no paso la validacion; guardado como .invalid para revision manual"
            );
        } else {
            console.log(
                `       OK: compila y Playwright lo reconoce (${bundle.supportFiles.length} archivo(s) de soporte)`
            );
        }

        results.push({
            testCaseId: testCase.id,
            title: testCase.title,
            filePath: path.relative(agentConfig.root, finalPath).replace(/\\/g, "/"),
            supportFiles: validation.ok ? bundle.supportFiles.map((file) => file.path) : [],
            validation: { ok: validation.ok, attempts, errors: validation.errors },
        });
    }

    return results;
}

const LOGIN_KEYWORDS = /login|iniciar sesi[oó]n|ingres[ao]r?|acceder|sign\s?in|autenticaci[oó]n/i;

/** Heuristica: si el TC habla de login/autenticacion, intenta revelar ese formulario antes del snapshot. */
function explorationTriggersFor(testCase: TestCase): RegExp[] {
    const text = [testCase.title, ...testCase.steps, testCase.expectedResult].join(" ");
    if (!LOGIN_KEYWORDS.test(text)) return [];

    return [
        /iniciar sesi[oó]n/i,
        /ingresar/i,
        /acceder/i,
        /mi cuenta/i,
        /login/i,
        /entrar/i,
    ];
}

function writeBundle(specFilePath: string, bundle: { specContent: string; supportFiles: FileEntry[] }): void {
    fs.writeFileSync(specFilePath, withGeneratedMarker(bundle.specContent), "utf-8");

    for (const file of bundle.supportFiles) {
        if (!isAllowedSupportPath(file.path)) continue;
        const absPath = path.join(agentConfig.root, file.path);
        fs.mkdirSync(path.dirname(absPath), { recursive: true });
        fs.writeFileSync(absPath, `${file.content.trimEnd()}\n`, "utf-8");
    }
}

function readIfExists(absPath: string): string | undefined {
    return fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : undefined;
}

/** Revierte un archivo de soporte: lo borra si el agente lo creo, o restaura su contenido original. */
function restoreSupportFile(absPath: string, original: string | undefined): void {
    if (original === undefined) {
        fs.rmSync(absPath, { force: true });
    } else {
        fs.writeFileSync(absPath, original, "utf-8");
    }
}

/** Ruta de import relativa desde la carpeta del modulo hacia el fixture del framework. */
function fixtureImportPath(fromDir: string): string {
    const relative = path
        .relative(fromDir, agentConfig.fixturesPath)
        .replace(/\\/g, "/")
        .replace(/\.ts$/, "");

    return relative.startsWith(".") ? relative : `./${relative}`;
}

const TAG_TO_MODULE_EXCLUDE = new Set(["smoke", "regression", "critical", "negative", "a11y", "visual"]);
const TITLE_MODULE_PREFIX = /^\s*\[([^[\]]+)\]/;

/**
 * Decide en que subcarpeta de tests/ cae el spec. Prioridad:
 * 1. Prefijo "[modulo]" en el titulo del TC (convencion de Xray: "[footer] ...").
 * 2. El primer tag de dominio (@footer, @home...).
 * 3. "generated" como ultimo recurso.
 */
function moduleForTestCase(testCase: TestCase): string {
    const titleMatch = testCase.title.match(TITLE_MODULE_PREFIX);
    if (titleMatch) return slugifyModule(titleMatch[1]);

    const domainTag = testCase.tags
        .map((tag) => tag.replace(/^@/, "").toLowerCase())
        .find((tag) => tag.length > 0 && !TAG_TO_MODULE_EXCLUDE.has(tag));

    return domainTag ?? "generated";
}

function slugifyModule(value: string): string {
    return (
        value
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "") || "generated"
    );
}

/** Marca el archivo como generado por el agente: sirve para no imitarlo como ejemplo (ver context.ts). */
function withGeneratedMarker(code: string): string {
    const MARKER = "// Generado por el Agente AQA - revisar antes de aprobar.";
    return code.trimStart().startsWith(MARKER) ? `${code}\n` : `${MARKER}\n${code}\n`;
}

function specFileName(testCase: TestCase): string {
    const slug = testCase.title
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);

    return `${testCase.id.toLowerCase()}-${slug}.spec.ts`;
}

function normalizeTags(tags: string[] | undefined): string[] {
    return (tags ?? [])
        .map((tag) => (tag.startsWith("@") ? tag : `@${tag}`))
        .filter((tag) => tag.length > 1);
}

function writeJson(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}
