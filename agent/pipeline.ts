import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "./config";
import { buildFrameworkContext } from "./framework/context";
import { collectExistingTests } from "./framework/inventory";
import { validateGeneratedFile } from "./framework/validate";
import { createProvider, extractCode, extractJson, type LlmProvider } from "./llm";
import {
    codegenPrompt,
    coveragePrompt,
    repairPrompt,
    SYSTEM_PROMPT,
    testCasesPrompt,
    type CodegenContext,
} from "./prompts";
import { createStorySource } from "./sources";
import { renderCoverageMarkdown, renderReport, renderTestCasesMarkdown } from "./report";
import type {
    AgentRunResult,
    CoverageItem,
    ExistingTest,
    GeneratedSpec,
    TestCase,
    UserStory,
} from "./types";

export interface RunOptions {
    storyKey: string;
    provider?: string;
    source?: string;
    /** Analiza y reporta, pero no escribe ningun spec. */
    dryRun?: boolean;
    /** Tambien genera codigo para los test cases marcados como "partial". */
    includePartial?: boolean;
}

export async function runAgent(options: RunOptions): Promise<AgentRunResult> {
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
    fs.mkdirSync(agentConfig.generatedTestsDir, { recursive: true });

    const frameworkContext = buildFrameworkContext();
    const importPath = fixtureImportPath();
    const results: GeneratedSpec[] = [];

    for (const testCase of pending) {
        const fileName = specFileName(testCase);
        const context: CodegenContext = { frameworkContext, importPath, fileName };
        const filePath = path.join(agentConfig.generatedTestsDir, fileName);

        console.log(`     - ${testCase.id} ${testCase.title}`);

        let code = extractCode(
            await provider.complete({
                system: SYSTEM_PROMPT,
                prompt: codegenPrompt(testCase, context),
            })
        );
        fs.writeFileSync(filePath, `${code}\n`, "utf-8");

        let validation = validateGeneratedFile(filePath);
        let attempts = 1;

        while (!validation.ok && attempts <= agentConfig.maxRepairAttempts) {
            console.log(
                `       validacion fallida, reparacion ${attempts}/${agentConfig.maxRepairAttempts}`
            );
            code = extractCode(
                await provider.complete({
                    system: SYSTEM_PROMPT,
                    prompt: repairPrompt(code, validation.errors, context),
                })
            );
            fs.writeFileSync(filePath, `${code}\n`, "utf-8");
            validation = validateGeneratedFile(filePath);
            attempts++;
        }

        let finalPath = filePath;

        if (!validation.ok) {
            // Un spec roto dentro de tests/ deja la suite en rojo para todo el
            // equipo. Se conserva para revision, pero fuera del alcance de Playwright.
            finalPath = `${filePath}.invalid`;
            fs.renameSync(filePath, finalPath);
            console.log(
                "       no paso la validacion; guardado como .invalid para revision manual"
            );
        } else {
            console.log("       OK: compila y Playwright lo reconoce");
        }

        results.push({
            testCaseId: testCase.id,
            title: testCase.title,
            filePath: path.relative(agentConfig.root, finalPath).replace(/\\/g, "/"),
            validation: { ok: validation.ok, attempts, errors: validation.errors },
        });
    }

    return results;
}

/** Ruta de import relativa desde tests/generated hacia el fixture del framework. */
function fixtureImportPath(): string {
    const relative = path
        .relative(agentConfig.generatedTestsDir, agentConfig.fixturesPath)
        .replace(/\\/g, "/")
        .replace(/\.ts$/, "");

    return relative.startsWith(".") ? relative : `./${relative}`;
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
