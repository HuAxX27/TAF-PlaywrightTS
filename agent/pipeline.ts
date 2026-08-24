import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "./config";
import { buildFrameworkContext, loadKindConventions } from "./framework/context";
import { classifyTestCases } from "./framework/classify";
import { explorePage } from "./framework/explore";
import {
    renderFinalValidationMarkdown,
    validateAgainstTestCase,
} from "./framework/finalValidation";
import {
    askKindOverride,
    askOpenQuestions,
    closeHumanChannel,
    confirm,
    isInteractive,
    requestApproval,
} from "./framework/human";
import { isAllowedSupportPath, parseFileBundle, type FileEntry } from "./framework/fileBundle";
import { collectExistingTests } from "./framework/inventory";
import { validateGeneratedFiles } from "./framework/validate";
import { executeTest, type TestError } from "./framework/e2eValidation";
import {
    runMultiAgentRepair,
    type MultiAgentResult,
    type RepairTarget,
} from "./framework/multiAgent";
import { closeSessionLearning, migrateLegacyDatabase, SessionRecorder } from "./framework/learning";
import {
    describeSessionLearning,
    factsForPrompt,
    findKnownAnswer,
    recordAvoidedQuestions,
} from "./framework/knowledge";
import { createProvider, extractJson, type LlmProvider } from "./llm";
import {
    clarifyPrompt,
    automationPlanPrompt,
    codegenPrompt,
    coveragePrompt,
    refinePrompt,
    repairPrompt,
    SYSTEM_PROMPT,
    type CodegenContext,
} from "./prompts";
import { createTestCaseSource } from "./sources";
import { renderCoverageMarkdown, renderReport, renderTestCasesMarkdown } from "./report";
import type {
    AgentRunResult,
    AnsweredQuestion,
    AutomationPlan,
    CoverageItem,
    ExistingTest,
    FinalValidationResult,
    GeneratedSpec,
    HumanReviewRound,
    KindDecision,
    OpenQuestion,
    TestCase,
    TestKind,
    XrayRunContext,
    E2EValidationResult,
} from "./types";

/** Recolector de la corrida en curso; se cierra y destila al final. */
let recorder: SessionRecorder;

export interface RunOptions {
    selector: string;
    provider?: string;
    /** Analiza y reporta, pero no escribe ningun spec. */
    dryRun?: boolean;
    /** Tambien genera codigo para los test cases marcados como "partial". */
    includePartial?: boolean;
    /** Salta preguntas y aprobaciones: acepta los supuestos del agente (CI). */
    nonInteractive?: boolean;
}

/** El usuario aborto el ciclo desde una puerta de aprobacion. */
export class AbortedByHumanError extends Error {
    constructor(stage: string) {
        super(`El QA aborto el proceso en la etapa "${stage}".`);
        this.name = "AbortedByHumanError";
    }
}

export async function runAgent(options: RunOptions): Promise<AgentRunResult> {
    const migration = migrateLegacyDatabase();
    if (migration) {
        console.log(`\n${migration}`);
    }

    if (options.nonInteractive) {
        agentConfig.interactive = false;
    }

    try {
        return await runFromTestCases(options);
    } finally {
        // Sin esto el proceso queda colgado esperando en stdin.
        closeHumanChannel();
    }
}

/** Test Cases de Xray -> candidates. */
async function runFromTestCases(options: RunOptions): Promise<AgentRunResult> {
    const provider = createProvider(options.provider);
    const source = createTestCaseSource();
    const artifactsDir = path.join(agentConfig.artifactsDir, runDirectoryName(options.selector));

    fs.mkdirSync(artifactsDir, { recursive: true });
    writeJson(path.join(artifactsDir, "00-run.json"), {
        selector: options.selector,
        startedAt: new Date().toISOString(),
        provider: provider.name,
        model: provider.model,
        candidatesDir: path
            .relative(agentConfig.root, agentConfig.candidatesDir)
            .replace(/\\/g, "/"),
    });
    recorder = new SessionRecorder(options.selector, provider);

    console.log(`\nAgente AQA  |  selector Xray: ${options.selector}`);
    console.log(`   proveedor: ${provider.name} (${provider.model})   origen: ${source.name}`);
    console.log(`   modo: ${describeMode()}\n`);

    // --- 1. Test cases ya definidos ------------------------------------------
    console.log("1/8  Leyendo Test Case(s) desde Xray...");
    let testCases = await source.fetch(options.selector);
    const xray: XrayRunContext = {
        selector: options.selector,
        label: testCases.length === 1 ? testCases[0].title : `Lote Xray: ${options.selector}`,
    };
    writeArtifacts(artifactsDir, xray, testCases);
    console.log(`     ${testCases.length} test case(s) importados de ${source.name}`);

    // --- 2. Revision humana: un TC importado casi siempre trae huecos --------
    console.log("2/8  Revision de los Test Cases importados...");
    const humanReview: HumanReviewRound[] = [];
    testCases = await reviewTestCasesWithHuman(
        provider,
        xray,
        testCases,
        humanReview,
        artifactsDir
    );

    return finishRun({
        provider,
        xray,
        testCases,
        artifactsDir,
        options,
        humanReview,
        firstStepNumber: 3,
        totalSteps: 8,
    });
}

function describeMode(): string {
    if (isInteractive()) return "interactivo (el agente pregunta y espera tu aprobacion)";
    return agentConfig.interactive
        ? "no interactivo (sin terminal interactiva: se aceptan los supuestos del agente)"
        : "no interactivo (se aceptan los supuestos del agente)";
}

interface FinishRunArgs {
    provider: LlmProvider;
    xray: XrayRunContext;
    testCases: TestCase[];
    artifactsDir: string;
    options: RunOptions;
    humanReview: HumanReviewRound[];
    firstStepNumber: number;
    totalSteps: number;
}

/**
 * Etapas comunes a los dos modos: clasificacion UI/API, inventario, cobertura,
 * generacion de codigo y validacion final contra el test case original.
 */
async function finishRun(args: FinishRunArgs): Promise<AgentRunResult> {
    const { provider, xray, testCases, artifactsDir, options, humanReview, totalSteps } = args;
    let step = args.firstStepNumber;
    const label = () => `${step++}/${totalSteps}`;

    // --- Clasificacion UI / API ----------------------------------------------
    console.log(`${label()}  Clasificando los test cases entre UI y API...`);
    const kindDecisions = await resolveKinds(provider, testCases);
    for (const testCase of testCases) {
        testCase.kind = kindOf(kindDecisions, testCase.id);
    }
    writeJson(path.join(artifactsDir, "02b-kind-decisions.json"), kindDecisions);
    writeArtifacts(artifactsDir, xray, testCases);

    const uiCount = kindDecisions.filter((decision) => decision.kind === "ui").length;
    console.log(`     UI: ${uiCount}  |  API: ${kindDecisions.length - uiCount}`);

    // --- Inventario del framework --------------------------------------------
    console.log(`${label()}  Inventariando las pruebas que ya existen...`);
    const { tests: inventory, source: inventorySource, warning } = collectExistingTests();
    writeJson(path.join(artifactsDir, "03-inventory.json"), inventory);

    if (warning) {
        console.warn(`     ! ${warning}`);
        console.warn("     ! se usara un escaneo de texto de los .spec.ts (menos preciso)");
    }
    console.log(`     ${inventory.length} pruebas existentes (via ${inventorySource})`);

    // --- Analisis de cobertura ------------------------------------------------
    console.log(`${label()}  Comparando los test cases contra la cobertura actual...`);
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

    // --- Generacion de codigo -------------------------------------------------
    const pending = selectPending(testCases, coverage, options.includePartial ?? false);
    let generated: GeneratedSpec[] = [];

    if (options.dryRun) {
        console.log(
            `${label()}  --dry-run: no se escribe codigo (${pending.length} specs quedarian por generar)`
        );
    } else if (pending.length === 0) {
        console.log(
            `${label()}  Nada que generar: los test cases ya estan cubiertos por las pruebas actuales.`
        );
    } else {
        console.log(`${label()}  Generando ${pending.length} specs...`);
        generated = await generateSpecs(
            provider,
            pending,
            collectAnswers(humanReview),
            humanReview,
            artifactsDir
        );

        // --- Validacion final: TC original vs codigo generado -----------------
        console.log(`${label()}  Validando el codigo generado contra el test case original...`);
        await runFinalValidation(provider, generated, pending, humanReview);
    }

    const finalValidations = generated
        .map((spec) => spec.finalValidation)
        .filter((validation): validation is FinalValidationResult => validation !== undefined);

    if (finalValidations.length > 0) {
        writeJson(path.join(artifactsDir, "06-final-validation.json"), finalValidations);
        fs.writeFileSync(
            path.join(artifactsDir, "06-final-validation.md"),
            renderFinalValidationMarkdown(testCases, finalValidations),
            "utf-8"
        );
    }

    if (humanReview.length > 0) {
        writeJson(path.join(artifactsDir, "07-human-review.json"), humanReview);
    }

    // --- Cierre: destilar la sesion en conocimiento reutilizable --------------
    console.log(`${label()}  Registrando lo aprendido en esta sesion...`);
    recorder.recordHumanReview(humanReview);
    const learning = await closeSessionLearning(provider, recorder);
    if (learning) {
        for (const line of describeSessionLearning(learning)) {
            console.log(`     ${line}`);
        }
    }

    writeJson(
        path.join(artifactsDir, "08-candidate-manifest.json"),
        generated.map((spec) => ({
            testCaseId: spec.testCaseId,
            kind: spec.kind,
            candidate: spec.filePath,
            status: !spec.validation.ok
                ? "needs_repair"
                : spec.finalValidation?.fullyCovered
                  ? "ready_for_review"
                  : "coverage_incomplete",
            supportFiles: spec.supportFiles,
            e2ePassed: spec.validation.e2eValidation?.passed ?? null,
        }))
    );

    const result: AgentRunResult = {
        xray,
        testCases,
        inventory,
        coverage,
        generated,
        artifactsDir,
        kindDecisions,
        humanReview,
        finalValidations,
        learning,
    };
    fs.writeFileSync(
        path.join(artifactsDir, "05-report.md"),
        renderReport(result, provider),
        "utf-8"
    );

    return result;
}

// ---------------------------------------------------------------------------
// Revision humana de los test cases
// ---------------------------------------------------------------------------

/**
 * Ciclo pregunta -> respuesta -> refinamiento -> aprobacion.
 *
 * No termina hasta que el humano aprueba (o aborta): cualquier supuesto que el
 * agente tuvo que hacer se le pregunta primero, y su respuesta se aplica a los
 * test cases antes de escribir una linea de codigo.
 */
async function reviewTestCasesWithHuman(
    provider: LlmProvider,
    xray: XrayRunContext,
    initial: TestCase[],
    humanReview: HumanReviewRound[],
    artifactsDir: string
): Promise<TestCase[]> {
    let testCases = initial;
    const alreadyAsked = new Set<string>();

    for (let round = 1; round <= agentConfig.maxReviewRounds; round++) {
        const detected = (await detectOpenQuestions(provider, xray, testCases)).filter(
            (question) => !alreadyAsked.has(normalizeQuestion(question.question))
        );
        for (const question of detected) {
            alreadyAsked.add(normalizeQuestion(question.question));
        }

        // Lo que el QA ya contesto en una sesion anterior no se vuelve a preguntar.
        const { questions, reused } = applyKnownFacts(detected);
        const { answers, hasNewInput } = await askOpenQuestions(questions);
        answers.push(...reused);

        printTestCasesSummary(testCases);
        const decision = await requestApproval("Aprobacion de los test cases", [
            `Detalle completo en: ${path.join(artifactsDir, "02-test-cases.md")}`,
            "Si algo esta mal o falta un escenario, elige [c]ambios y describelo.",
        ]);

        humanReview.push({
            round,
            stage: "test-cases",
            questions: answers,
            feedback: decision.action === "revise" ? decision.feedback : undefined,
            approved: decision.action === "approve",
        });

        if (decision.action === "abort") {
            throw new AbortedByHumanError("revision de test cases");
        }

        if (decision.action === "approve") {
            // Aun aprobando, las respuestas nuevas se aplican: son datos que el
            // codigo necesita y que el humano acaba de aportar.
            if (hasNewInput) {
                console.log("     aplicando tus respuestas a los test cases...");
                testCases = await refineTestCases(provider, xray, testCases, answers, undefined);
                writeArtifacts(artifactsDir, xray, testCases);
            }
            console.log("     test cases aprobados.");
            return testCases;
        }

        console.log(`     aplicando los cambios pedidos (ronda ${round})...`);
        testCases = await refineTestCases(provider, xray, testCases, answers, decision.feedback);
        writeArtifacts(artifactsDir, xray, testCases);
    }

    console.warn(
        `     ! se alcanzo el maximo de ${agentConfig.maxReviewRounds} rondas; se continua con la ultima version.`
    );
    return testCases;
}

function writeArtifacts(artifactsDir: string, xray: XrayRunContext, testCases: TestCase[]): void {
    writeJson(path.join(artifactsDir, "02-test-cases.json"), testCases);
    fs.writeFileSync(
        path.join(artifactsDir, "02-test-cases.md"),
        renderTestCasesMarkdown(xray, testCases),
        "utf-8"
    );
}

function printTestCasesSummary(testCases: TestCase[]): void {
    console.log("\n  Test cases actuales:");
    for (const testCase of testCases) {
        const kind = testCase.kind ? ` [${testCase.kind.toUpperCase()}]` : "";
        const automatable = testCase.automatable ? "" : " (no automatizable)";
        console.log(`    ${testCase.id}${kind} ${testCase.title}${automatable}`);
    }
}

async function detectOpenQuestions(
    provider: LlmProvider,
    xray: XrayRunContext,
    testCases: TestCase[]
): Promise<OpenQuestion[]> {
    try {
        const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: clarifyPrompt(xray, testCases),
        });
        const parsed = extractJson<Array<Partial<OpenQuestion>>>(raw);

        return parsed
            .filter((item) => item.question?.trim())
            .slice(0, 6)
            .map((item, index) => ({
                id: item.id?.trim() || `Q-${String(index + 1).padStart(2, "0")}`,
                question: item.question!.trim(),
                why: item.why?.trim() || "El agente no explico el impacto.",
                assumptionIfUnanswered:
                    item.assumptionIfUnanswered?.trim() ||
                    "El agente mantendria el test case como esta.",
                relatedTestCaseIds: (item.relatedTestCaseIds ?? []).map((id) => String(id)),
            }));
    } catch (error) {
        // La aprobacion humana es la salvaguarda real; sin preguntas el ciclo sigue.
        console.warn(
            `     ! no se pudieron detectar dudas (${error instanceof Error ? error.message : String(error)}).`
        );
        return [];
    }
}

async function refineTestCases(
    provider: LlmProvider,
    xray: XrayRunContext,
    testCases: TestCase[],
    answers: AnsweredQuestion[],
    feedback: string | undefined
): Promise<TestCase[]> {
    try {
        const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: refinePrompt(xray, testCases, answers, feedback),
        });
        const refined = normalizeTestCases(extractJson<Partial<TestCase>[]>(raw));
        return refined.length > 0 ? refined : testCases;
    } catch (error) {
        console.warn(
            `     ! no se pudieron refinar los test cases (${error instanceof Error ? error.message : String(error)}); se conserva la version anterior.`
        );
        return testCases;
    }
}

function normalizeQuestion(question: string): string {
    return question
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

/**
 * Resuelve con la base de conocimiento las dudas que el QA ya contesto antes.
 *
 * Es el ahorro mas visible del aprendizaje: menos interrupciones al humano y
 * menos tokens gastados en redisenar lo mismo cada corrida.
 */
function applyKnownFacts(questions: OpenQuestion[]): {
    questions: OpenQuestion[];
    reused: AnsweredQuestion[];
} {
    const pending: OpenQuestion[] = [];
    const reused: AnsweredQuestion[] = [];

    for (const question of questions) {
        const known = findKnownAnswer(question.question);
        if (!known) {
            pending.push(question);
            continue;
        }

        console.log(`     ya respondido antes: ${question.question}`);
        console.log(`       -> ${known.answer}`);
        // Se marca como respuesta humana porque lo fue: en una sesion anterior.
        reused.push({ ...question, answer: known.answer, answeredByHuman: true });
    }

    recordAvoidedQuestions(reused.length);
    return { questions: pending, reused };
}

function collectAnswers(humanReview: HumanReviewRound[]): AnsweredQuestion[] {
    return humanReview.flatMap((round) => round.questions);
}

// ---------------------------------------------------------------------------
// Clasificacion UI / API
// ---------------------------------------------------------------------------

/** Clasifica y deja que el humano corrija los casos donde el agente duda. */
async function resolveKinds(provider: LlmProvider, testCases: TestCase[]): Promise<KindDecision[]> {
    const decisions = await classifyTestCases(provider, testCases);
    const byId = new Map(testCases.map((testCase) => [testCase.id, testCase]));

    for (const decision of decisions) {
        // Solo se molesta al humano cuando la senal es debil; lo obvio no se pregunta.
        if (decision.confidence >= agentConfig.kindConfidenceThreshold) continue;

        const chosen = await askKindOverride(
            decision.testCaseId,
            byId.get(decision.testCaseId)?.title ?? "",
            decision.kind,
            decision.rationale
        );

        if (chosen !== decision.kind) {
            decision.kind = chosen;
            decision.confidence = 100;
            decision.rationale = "Clasificacion corregida por el QA.";
            decision.decidedBy = "human";
            recorder.recordKindOverride(decision.testCaseId, chosen);
        }
    }

    return decisions;
}

function kindOf(decisions: KindDecision[], testCaseId: string): TestKind {
    return decisions.find((decision) => decision.testCaseId === testCaseId)?.kind ?? "ui";
}

function normalizeTestCases(items: Partial<TestCase>[]): TestCase[] {
    return items.map((testCase, index) => ({
        id: testCase.id?.trim() || `TC-${String(index + 1).padStart(2, "0")}`,
        title: testCase.title?.trim() || `Escenario ${index + 1}`,
        level: testCase.level ?? "e2e",
        // Se deja sin resolver a proposito: la etapa de clasificacion decide.
        kind: testCase.kind === "api" || testCase.kind === "ui" ? testCase.kind : undefined,
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

/**
 * Planeacion separada: si el modelo falla al planear, el fallback es explicito
 * y conservador. El codegen recibe este contrato en vez de reinterpretar el TC.
 */
async function createAutomationPlan(
    provider: LlmProvider,
    testCase: TestCase,
    kind: TestKind
): Promise<AutomationPlan> {
    const fallback: AutomationPlan = {
        testCaseId: testCase.id,
        kind,
        module: moduleForTestCase(testCase),
        startPath: "/",
        requiredEvidence: testCase.steps.filter(Boolean),
        assertions: testCase.expectedResult ? [testCase.expectedResult] : [],
        filesToModify: ["spec"],
        risks: ["Plan de respaldo: revisar evidencia de UI antes de promover el candidate."],
    };

    try {
        const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: automationPlanPrompt(testCase, kind),
        });
        const parsed = extractJson<Partial<AutomationPlan>>(raw);
        return {
            ...fallback,
            testCaseId: testCase.id,
            kind,
            module: slugifyModule(parsed.module ?? fallback.module),
            startPath: safeStartPath(parsed.startPath),
            requiredEvidence: cleanList(parsed.requiredEvidence, fallback.requiredEvidence),
            assertions: cleanList(parsed.assertions, fallback.assertions),
            filesToModify: cleanList(parsed.filesToModify, fallback.filesToModify),
            risks: cleanList(parsed.risks, fallback.risks),
        };
    } catch (error) {
        console.warn(
            `       ! no se pudo planear ${testCase.id}; se usa un plan conservador (${error instanceof Error ? error.message : String(error)})`
        );
        return fallback;
    }
}

function cleanList(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) return fallback;
    const items = value
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, 20);
    return items.length > 0 ? items : fallback;
}

/** El plan puede elegir rutas relativas del sitio, nunca URLs externas ni javascript:. */
function safeStartPath(value: unknown): string {
    const pathValue = typeof value === "string" ? value.trim() : "/";
    return pathValue.startsWith("/") && !pathValue.startsWith("//") ? pathValue : "/";
}

async function generateSpecs(
    provider: LlmProvider,
    pending: TestCase[],
    humanAnswers: AnsweredQuestion[],
    humanReview: HumanReviewRound[],
    artifactsDir: string
): Promise<GeneratedSpec[]> {
    // El contexto se arma una vez por tipo: son dos vistas distintas del framework.
    const frameworkContextByKind = new Map<TestKind, string>();
    const results: GeneratedSpec[] = [];
    const plans: AutomationPlan[] = [];

    for (const testCase of pending) {
        const kind: TestKind = testCase.kind ?? "ui";
        const automationPlan = await createAutomationPlan(provider, testCase, kind);
        plans.push(automationPlan);
        if (!frameworkContextByKind.has(kind)) {
            frameworkContextByKind.set(kind, buildFrameworkContext(kind));
        }

        // tests/ui/<modulo>/ y tests/api/<modulo>/ separan los dos mundos.
        const moduleDir = path.join(agentConfig.candidatesDir, kind, automationPlan.module);
        fs.mkdirSync(moduleDir, { recursive: true });

        const filePath = path.join(moduleDir, specFileName(testCase));
        const specRelPath = path.relative(agentConfig.root, filePath).replace(/\\/g, "/");

        console.log(`     - ${testCase.id} [${kind.toUpperCase()}] ${testCase.title}`);
        console.log(`       destino: ${specRelPath}`);

        const context: CodegenContext = {
            frameworkContext: frameworkContextByKind.get(kind)!,
            importPath: fixtureImportPath(moduleDir),
            specRelPath,
            kind,
            kindConventions: loadKindConventions(kind),
            automationPlan,
            humanAnswers,
            domainFacts: factsForPrompt(factAreasFor(testCase)),
            ...(await explorationContext(kind, testCase, automationPlan.startPath)),
        };

        results.push(
            await generateWithHumanApproval(
                provider,
                testCase,
                kind,
                filePath,
                context,
                humanReview
            )
        );
    }

    writeJson(path.join(artifactsDir, "05-automation-plans.json"), plans);
    return results;
}

/** La exploracion en vivo solo aporta a los tests de UI: un test de API no tiene pagina. */
async function explorationContext(
    kind: TestKind,
    testCase: TestCase,
    startPath: string
): Promise<Pick<CodegenContext, "pageExploration" | "explorationWarning">> {
    if (kind === "api") return {};

    const exploration = await explorePage(startPath, explorationTriggersFor(testCase));
    if (exploration.warning) {
        console.log(`       ! exploracion en vivo fallo: ${exploration.warning}`);
        return { explorationWarning: exploration.warning };
    }
    if (exploration.triggeredAction) {
        console.log(`       exploracion: click en "${exploration.triggeredAction}"`);
    }
    return { pageExploration: exploration.ariaSnapshot };
}

/**
 * Genera el spec y no lo da por bueno hasta que el humano aprueba. Si pide
 * cambios, se regenera con su feedback como entrada del prompt.
 */
async function generateWithHumanApproval(
    provider: LlmProvider,
    testCase: TestCase,
    kind: TestKind,
    filePath: string,
    baseContext: CodegenContext,
    humanReview: HumanReviewRound[]
): Promise<GeneratedSpec> {
    let context = baseContext;
    let spec = await generateOneSpec(provider, testCase, kind, filePath, context);

    for (let round = 1; round <= agentConfig.maxReviewRounds; round++) {
        const decision = await requestApproval(
            `Aprobacion del spec de ${testCase.id} [${kind.toUpperCase()}]`,
            [
                `Archivo: ${spec.filePath}`,
                spec.supportFiles.length > 0
                    ? `Soporte: ${spec.supportFiles.join(", ")}`
                    : "Sin archivos de soporte nuevos.",
                spec.validation.ok
                    ? "Validacion estatica y E2E: OK"
                    : `Requiere atencion: ${spec.validation.errors.slice(0, 2).map(firstLine).join(" | ") || "revisar el spec"}`,
            ]
        );

        humanReview.push({
            round,
            stage: "code",
            questions: [],
            feedback: decision.action === "revise" ? decision.feedback : undefined,
            approved: decision.action === "approve",
        });

        if (decision.action === "abort") {
            throw new AbortedByHumanError(`aprobacion del spec ${testCase.id}`);
        }
        if (decision.action === "approve") {
            return spec;
        }

        console.log(`       regenerando el spec con tu feedback (ronda ${round})...`);
        context = { ...context, humanFeedback: decision.feedback };
        spec = await generateOneSpec(provider, testCase, kind, filePath, context);
    }

    console.warn(
        `     ! se alcanzo el maximo de rondas para ${testCase.id}; se conserva la ultima version.`
    );
    return spec;
}

async function generateOneSpec(
    provider: LlmProvider,
    testCase: TestCase,
    kind: TestKind,
    filePath: string,
    context: CodegenContext
): Promise<GeneratedSpec> {
    // Guarda el contenido previo de cualquier archivo de soporte que el modelo
    // toque, para poder revertirlo si el bundle final no pasa la validacion.
    const originalSupportContent = new Map<string, string | undefined>();
    const trackOriginal = (relPath: string) => {
        if (!originalSupportContent.has(relPath)) {
            originalSupportContent.set(relPath, readIfExists(path.join(agentConfig.root, relPath)));
        }
    };

    let bundle = parseFileBundle(
        await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: codegenPrompt(testCase, context),
        }),
        context.specRelPath
    );
    bundle.supportFiles.forEach((file) => trackOriginal(file.path));
    writeBundle(filePath, bundle);

    let validation = validateGeneratedFiles(
        filePath,
        bundle.supportFiles.map((file) => path.join(agentConfig.root, file.path))
    );
    let attempts = 1;
    const codeBeforeRepairs = bundle.specContent;
    const repairErrors: string[] = [];

    while (!validation.ok && attempts <= agentConfig.maxRepairAttempts) {
        console.log(
            `       validacion fallida, reparacion ${attempts}/${agentConfig.maxRepairAttempts}`
        );
        repairErrors.push(...validation.errors);
        const currentFiles: FileEntry[] = [
            { path: context.specRelPath, content: bundle.specContent },
            ...bundle.supportFiles,
        ];
        bundle = parseFileBundle(
            await provider.complete({
                system: SYSTEM_PROMPT,
                prompt: repairPrompt(currentFiles, validation.errors, context),
            }),
            context.specRelPath
        );
        bundle.supportFiles.forEach((file) => trackOriginal(file.path));
        writeBundle(filePath, bundle);
        validation = validateGeneratedFiles(
            filePath,
            bundle.supportFiles.map((file) => path.join(agentConfig.root, file.path))
        );

        attempts++;
    }

    let e2eValidationResult: E2EValidationResult | undefined = undefined;
    const passedStaticFirstTry = repairErrors.length === 0;

    if (!validation.ok) {
        // El spec no compila: se revierten los archivos de soporte para no dejar el
        // framework roto y el spec queda anotado con el diagnostico para revision manual.
        for (const [relPath, original] of originalSupportContent) {
            restoreSupportFile(path.join(agentConfig.root, relPath), original);
        }
        annotateForManualReview(filePath, undefined, validation.errors);
        console.log("       no paso la validacion estatica; spec anotado para revision manual");
        recorder.recordRepair(
            testCase.id,
            kind,
            repairErrors,
            codeBeforeRepairs,
            bundle.specContent
        );
    } else {
        console.log(
            `       OK: compila y Playwright lo reconoce (${bundle.supportFiles.length} archivo(s) de soporte)`
        );
        if (repairErrors.length > 0) {
            // El diff entre el primer intento y el que si compilo es la senal que
            // permite deducir la regla que habria evitado el error desde el inicio.
            recorder.recordRepair(
                testCase.id,
                kind,
                repairErrors,
                codeBeforeRepairs,
                bundle.specContent
            );
        }

        // Validación E2E: ejecutar el test contra la app real (SIEMPRE)
        if (agentConfig.enableE2EValidation) {
            console.log("       [Validacion E2E] ejecutando test contra la aplicacion...");
            const codeBeforeE2E = bundle.specContent;
            e2eValidationResult = await performE2EValidation(
                provider,
                filePath,
                context,
                bundle.supportFiles.map((file) => file.path)
            );

            if (!e2eValidationResult.passed) {
                console.log(
                    `       test no paso E2E despues de ${e2eValidationResult.attempts} intento(s)`
                );
                if (e2eValidationResult.multiAgentAnalysis) {
                    console.log(
                        `       causa raiz: ${e2eValidationResult.multiAgentAnalysis.rootCause}`
                    );
                }

                // Los archivos de soporte reparados se conservan: el diagnostico y las
                // correcciones parciales son lo que el QA necesita para terminar el arreglo.
                annotateForManualReview(filePath, e2eValidationResult, validation.errors);
                console.log(
                    "       spec anotado con el diagnostico y marcado test.fixme para revision manual"
                );

                // Actualizar validation.ok para reflejar el fallo E2E
                validation = {
                    ok: false,
                    errors: [
                        ...validation.errors,
                        ...e2eValidationResult.errors.map((error) => error.message),
                    ],
                };
            } else {
                console.log(
                    `       ✓ test pasó en ejecución E2E (intento ${e2eValidationResult.attempts})`
                );
                if (e2eValidationResult.attempts > 1) {
                    const currentContent = readIfExists(filePath) ?? bundle.specContent;
                    recorder.recordRepair(
                        testCase.id,
                        kind,
                        e2eValidationResult.errors.map((error) => error.message),
                        codeBeforeE2E,
                        currentContent
                    );
                }
            }
        }
    }

    const repairAttempts = attempts - 1 + Math.max((e2eValidationResult?.attempts ?? 1) - 1, 0);
    recorder.recordSpec({
        testCaseId: testCase.id,
        kind,
        specPath: path.relative(agentConfig.root, filePath).replace(/\\/g, "/"),
        supportFiles: bundle.supportFiles.map((file) => file.path),
        passedFirstTry: passedStaticFirstTry && (e2eValidationResult?.attempts ?? 1) === 1,
        repairAttempts,
    });

    return {
        testCaseId: testCase.id,
        title: testCase.title,
        kind,
        filePath: path.relative(agentConfig.root, filePath).replace(/\\/g, "/"),
        supportFiles: validation.ok ? bundle.supportFiles.map((file) => file.path) : [],
        validation: {
            ok: validation.ok,
            attempts,
            errors: validation.errors,
            e2eValidation: e2eValidationResult,
        },
    };
}

// ---------------------------------------------------------------------------
// Validacion final: test case original vs codigo generado
// ---------------------------------------------------------------------------

/**
 * Ultima puerta antes de cerrar: se compara el TC original con el codigo real y,
 * si quedan escenarios sin cubrir, se le pide al humano que decida.
 */
async function runFinalValidation(
    provider: LlmProvider,
    generated: GeneratedSpec[],
    pending: TestCase[],
    humanReview: HumanReviewRound[]
): Promise<void> {
    if (!agentConfig.enableFinalValidation) {
        console.log("     validacion final desactivada (ENABLE_FINAL_VALIDATION=false)");
        return;
    }

    const byId = new Map(pending.map((testCase) => [testCase.id, testCase]));

    for (const spec of generated) {
        const testCase = byId.get(spec.testCaseId);
        if (!testCase) continue;

        const absPath = path.join(agentConfig.root, spec.filePath);
        if (!fs.existsSync(absPath)) continue;

        const validation = await validateAgainstTestCase(
            provider,
            testCase,
            absPath,
            spec.supportFiles
        );
        spec.finalValidation = validation;

        console.log(
            `     - ${spec.testCaseId}: ${validation.coveragePercent}% de los escenarios del test case ${validation.fullyCovered ? "(completo)" : "(INCOMPLETO)"}`
        );
        console.log(`       ${validation.verdict}`);

        if (validation.fullyCovered) {
            validation.approvedByHuman = true;
            continue;
        }

        for (const missing of validation.missingScenarios) {
            console.log(`       falta: ${missing}`);
        }
        recorder.recordCoverageGap(spec.testCaseId, validation.missingScenarios);

        validation.approvedByHuman = await confirm(
            `Aceptar ${spec.testCaseId} con ${validation.missingScenarios.length} escenario(s) sin cubrir?`,
            false
        );

        humanReview.push({
            round: humanReview.length + 1,
            stage: "code",
            questions: [],
            feedback: validation.approvedByHuman
                ? undefined
                : `Cobertura incompleta pendiente en ${spec.testCaseId}: ${validation.missingScenarios.join("; ")}`,
            approved: validation.approvedByHuman,
        });

        if (!validation.approvedByHuman) {
            annotateMissingCoverage(absPath, validation.missingScenarios);
            console.log("       spec anotado con los escenarios faltantes para completarlo a mano");
        }
    }
}

/** Deja los escenarios sin cubrir escritos en el spec, donde el QA los va a ver. */
function annotateMissingCoverage(specPath: string, missingScenarios: string[]): void {
    if (missingScenarios.length === 0) return;

    const original = fs.readFileSync(specPath, "utf-8");
    if (original.includes("COBERTURA INCOMPLETA respecto al test case original")) return;

    const header = [
        "// ============================================================",
        "// COBERTURA INCOMPLETA respecto al test case original",
        ...missingScenarios.map((scenario) => `//   - falta: ${firstLine(scenario)}`),
        "// ============================================================",
        "",
    ].join("\n");

    fs.writeFileSync(specPath, `${header}${original}`, "utf-8");
}

const LOGIN_KEYWORDS = /login|iniciar sesi[oó]n|ingres[ao]r?|acceder|sign\s?in|autenticaci[oó]n/i;

/** Heuristica: si el TC habla de login/autenticacion, intenta revelar ese formulario antes del snapshot. */
function explorationTriggersFor(testCase: TestCase): RegExp[] {
    const text = [testCase.title, ...testCase.steps, testCase.expectedResult].join(" ");
    if (!LOGIN_KEYWORDS.test(text)) return [];

    return [/iniciar sesi[oó]n/i, /ingresar/i, /acceder/i, /mi cuenta/i, /login/i, /entrar/i];
}

function writeBundle(
    specFilePath: string,
    bundle: { specContent: string; supportFiles: FileEntry[] }
): void {
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

const TAG_TO_MODULE_EXCLUDE = new Set([
    "smoke",
    "regression",
    "critical",
    "negative",
    "a11y",
    "visual",
    "api",
    "ui",
    "e2e",
    "cdn",
]);
const TITLE_MODULE_PREFIX = /^\s*\[([^[\]]+)\]/;

/**
 * Decide en que subcarpeta de tests/<kind>/ cae el spec. Prioridad:
 * 1. Prefijo "[modulo]" en el titulo del TC.
 * 2. El primer tag de dominio.
 * 3. "generated" como ultimo recurso.
 */
function moduleForTestCase(testCase: TestCase): string {
    const titleMatch = testCase.title.match(TITLE_MODULE_PREFIX);
    if (titleMatch) return slugifyModule(titleMatch[1]);

    // Buscar tags de dominio (no técnicos)
    const domainTag = testCase.tags
        .map((tag) => tag.replace(/^@/, "").toLowerCase())
        .find((tag) => tag.length > 0 && !TAG_TO_MODULE_EXCLUDE.has(tag));

    if (domainTag) return slugifyModule(domainTag);

    return "generated";
}

/** Mismas senales que moduleForTestCase, para buscar hechos del dominio relevantes. */
function factAreasFor(testCase: TestCase): string[] {
    const domainTags = testCase.tags
        .map((tag) => tag.replace(/^@/, "").toLowerCase())
        .filter((tag) => tag.length > 0 && !TAG_TO_MODULE_EXCLUDE.has(tag));

    return [...new Set([moduleForTestCase(testCase), ...domainTags])];
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

/** Carpetas de artefactos validas tambien para JQLs con espacios, comillas o ':'. */
function runDirectoryName(selector: string): string {
    const slug = selector
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
    const hash = Array.from(selector).reduce(
        (value, char) => (value * 31 + char.charCodeAt(0)) >>> 0,
        0
    );
    return `${slug || "xray-batch"}-${hash.toString(36)}`;
}

/** Marca el archivo como generado por el agente: sirve para no imitarlo como ejemplo (ver context.ts). */
function withGeneratedMarker(code: string): string {
    const MARKER =
        "// Candidate generado por el Agente AQA - no ejecutar en regresion hasta promoverlo.";
    return code.trimStart().startsWith(MARKER) ? `${code}\n` : `${MARKER}\n${code}\n`;
}

function specFileName(testCase: TestCase): string {
    const ignored = new Set([
        "la",
        "el",
        "los",
        "las",
        "de",
        "del",
        "para",
        "que",
        "y",
        "en",
        "un",
        "una",
        "con",
        "al",
        "se",
        "esta",
        "este",
        "debe",
        "ser",
        "su",
    ]);
    const slug =
        testCase.title
            .toLowerCase()
            .normalize("NFD")
            .replace(/\p{Diacritic}/gu, "")
            .split(/[^a-z0-9]+/)
            .filter(
                (word) =>
                    word.length > 2 && !ignored.has(word) && word !== testCase.id.toLowerCase()
            )
            .slice(0, 5)
            .join("-")
            .slice(0, 40) || "scenario";

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

/**
 * Validación E2E con sistema multiagente:
 * 1. Ejecuta el test contra la app real
 * 2. Si falla, usa multiagentes para analizar y reparar
 * 3. Reintenta hasta maxE2ERepairAttempts
 */
async function performE2EValidation(
    provider: LlmProvider,
    specPath: string,
    context: CodegenContext,
    supportRelPaths: string[]
): Promise<E2EValidationResult> {
    const maxAttempts = agentConfig.maxE2ERepairAttempts;
    let e2eAttempt = 0;
    let lastErrors: TestError[] = [];
    let lastAnalysis: MultiAgentResult["analysis"] | undefined;

    while (e2eAttempt < maxAttempts) {
        e2eAttempt++;

        const testResult = executeTest(specPath);

        if (testResult.passed) {
            return {
                executed: true,
                passed: true,
                attempts: e2eAttempt,
                errors: [],
                multiAgentAnalysis: lastAnalysis
                    ? {
                          rootCause: lastAnalysis.rootCause,
                          category: lastAnalysis.errorCategory,
                          confidence: lastAnalysis.confidence,
                      }
                    : undefined,
            };
        }

        lastErrors = testResult.errors;
        console.log(
            `       intento ${e2eAttempt}/${maxAttempts}: test fallo con ${testResult.errors.length} error(es)`
        );
        for (const error of testResult.errors.slice(0, 2)) {
            console.log(`         [${error.type}] ${firstLine(error.message)}`);
        }

        if (e2eAttempt >= maxAttempts) break;

        console.log("       activando sistema multiagente para reparacion...");
        const supportFiles = readRepairTargets(supportRelPaths);
        const snapshot = snapshotFiles([specPath, ...supportFiles.map((f) => absOf(f.relPath))]);

        const multiAgentResult = await runMultiAgentRepair(
            provider,
            specPath,
            testResult.errors,
            testResult.stdout,
            testResult.screenshots,
            context,
            supportFiles
        );
        lastAnalysis = multiAgentResult.analysis;

        if (multiAgentResult.proposals.length === 0) {
            console.log("       sin propuestas de reparacion; se detiene el ciclo");
            break;
        }

        const applied: string[] = [];
        for (const proposal of multiAgentResult.proposals) {
            if (!isRepairableTarget(proposal.filePath, specPath)) {
                console.log(`       propuesta ignorada (ruta no permitida): ${proposal.filePath}`);
                continue;
            }
            const targetPath = absOf(proposal.filePath);
            console.log(`       aplicando correccion a ${proposal.filePath}`);
            fs.mkdirSync(path.dirname(targetPath), { recursive: true });
            fs.writeFileSync(targetPath, `${proposal.repairedCode.trimEnd()}\n`, "utf-8");
            applied.push(proposal.filePath);
        }

        if (applied.length === 0) {
            console.log("       ninguna propuesta aplicable; se detiene el ciclo");
            break;
        }

        const staticValidation = validateGeneratedFiles(specPath, []);
        if (!staticValidation.ok) {
            console.log("       codigo reparado no compila; revirtiendo al estado anterior");
            restoreSnapshot(snapshot);
            break;
        }
    }

    return {
        executed: true,
        passed: false,
        attempts: e2eAttempt,
        errors: lastErrors.map((error) => ({ type: error.type, message: error.message })),
        multiAgentAnalysis: {
            rootCause: lastAnalysis?.rootCause ?? "No se pudo determinar la causa raiz",
            category: lastAnalysis?.errorCategory ?? "unknown",
            confidence: lastAnalysis?.confidence ?? 0,
            suggestedFixes: lastAnalysis?.suggestedFixes ?? [],
        },
    };
}

function absOf(relPath: string): string {
    return path.join(agentConfig.root, relPath);
}

function firstLine(text: string): string {
    const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? text;
    return line.length > 180 ? `${line.slice(0, 180)}...` : line.trim();
}

function readRepairTargets(relPaths: string[]): RepairTarget[] {
    return relPaths
        .filter((relPath) => fs.existsSync(absOf(relPath)))
        .map((relPath) => ({ relPath, content: fs.readFileSync(absOf(relPath), "utf-8") }));
}

/** Solo el spec y los directorios de soporte permitidos pueden ser reescritos por el reparador. */
function isRepairableTarget(relPath: string, specPath: string): boolean {
    const clean = relPath.replace(/\\/g, "/");
    const specRel = path.relative(agentConfig.root, specPath).replace(/\\/g, "/");
    return clean === specRel || isAllowedSupportPath(clean);
}

function snapshotFiles(absPaths: string[]): Map<string, string | undefined> {
    const snapshot = new Map<string, string | undefined>();
    for (const absPath of absPaths) {
        snapshot.set(
            absPath,
            fs.existsSync(absPath) ? fs.readFileSync(absPath, "utf-8") : undefined
        );
    }
    return snapshot;
}

function restoreSnapshot(snapshot: Map<string, string | undefined>): void {
    for (const [absPath, content] of snapshot) {
        if (content === undefined) {
            if (fs.existsSync(absPath)) fs.rmSync(absPath);
        } else {
            fs.writeFileSync(absPath, content, "utf-8");
        }
    }
}

/**
 * Un spec que no pasa E2E se conserva ejecutable pero con test.fixme() y un encabezado que
 * explica el diagnostico, para que el QA lo corrija a mano sin adivinar.
 */
function annotateForManualReview(
    specPath: string,
    e2eResult: E2EValidationResult | undefined,
    staticErrors: string[]
): void {
    const analysis = e2eResult?.multiAgentAnalysis;
    const lines = [
        "// ============================================================",
        "// REVISION MANUAL REQUERIDA - el agente no pudo hacer pasar este test",
        "// ------------------------------------------------------------",
    ];

    if (analysis?.rootCause) {
        lines.push(`// Causa raiz detectada: ${analysis.rootCause}`);
        lines.push(
            `// Categoria: ${analysis.category} | Confianza del diagnostico: ${analysis.confidence}%`
        );
    }

    for (const fix of analysis?.suggestedFixes ?? []) {
        lines.push(`// Correccion sugerida: ${fix}`);
    }

    const errors = [...staticErrors, ...(e2eResult?.errors.map((e) => e.message) ?? [])];
    if (errors.length > 0) {
        lines.push("// Errores observados:");
        for (const error of errors.slice(0, 5)) {
            lines.push(`//   - ${firstLine(error)}`);
        }
    }

    lines.push(
        "// Al corregirlo, cambia test.fixme( por test( para reactivar la ejecucion.",
        "// ============================================================",
        ""
    );

    const original = fs.readFileSync(specPath, "utf-8");
    // test.fixme mantiene el spec compilando y visible en el reporte, pero sin romper la suite.
    const skipped = original.replace(/(\n\s*)test\(/g, "$1test.fixme(");
    fs.writeFileSync(specPath, `${lines.join("\n")}${skipped}`, "utf-8");
}
