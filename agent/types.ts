/** Contratos compartidos por todo el pipeline del agente AQA. */

export interface UserStory {
    key: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    labels: string[];
    url?: string;
}

export type TestPriority = "critical" | "high" | "medium" | "low";
export type TestLevel = "e2e" | "api" | "visual" | "a11y";

/**
 * Naturaleza tecnica del test. Define convenciones, carpeta destino y prompt de
 * codegen: un test de API no abre navegador ni usa Page Objects.
 */
export type TestKind = "ui" | "api";

/** Un Test Case en lenguaje de negocio, antes de existir como codigo. */
export interface TestCase {
    id: string;
    title: string;
    level: TestLevel;
    /** Se resuelve en la etapa de clasificacion; puede venir vacio de la fuente. */
    kind?: TestKind;
    priority: TestPriority;
    tags: string[];
    preconditions: string[];
    steps: string[];
    expectedResult: string;
    automatable: boolean;
    notAutomatableReason?: string;
}

/** Veredicto de clasificacion UI/API de un test case, con su justificacion. */
export interface KindDecision {
    testCaseId: string;
    kind: TestKind;
    confidence: number;
    rationale: string;
    /** "heuristic" | "llm" | "human" - quien tomo la decision final. */
    decidedBy: "heuristic" | "llm" | "human";
}

/** Duda o supuesto que el agente NO quiere resolver solo: se la pregunta al humano. */
export interface OpenQuestion {
    id: string;
    question: string;
    /** Por que bloquea o degrada el diseno del test case. */
    why: string;
    /** Que asumiria el agente si nadie responde. */
    assumptionIfUnanswered: string;
    relatedTestCaseIds: string[];
}

export interface AnsweredQuestion extends OpenQuestion {
    /** Respuesta del humano, o el supuesto aceptado si decidio no responder. */
    answer: string;
    answeredByHuman: boolean;
}

/** Registro de una ronda de interaccion humana, para trazabilidad en el reporte. */
export interface HumanReviewRound {
    round: number;
    stage: "test-cases" | "code";
    questions: AnsweredQuestion[];
    /** Feedback libre que el humano dio para pedir cambios. */
    feedback?: string;
    approved: boolean;
}

/** Una prueba que YA existe en el repositorio. */
export interface ExistingTest {
    title: string;
    file: string;
    line?: number;
    tags: string[];
}

export type CoverageStatus = "covered" | "partial" | "missing";

export interface CoverageItem {
    testCaseId: string;
    status: CoverageStatus;
    matchedTests: string[];
    rationale: string;
}

export interface ValidationResult {
    ok: boolean;
    attempts: number;
    errors: string[];
    e2eValidation?: E2EValidationResult;
}

export interface E2EValidationResult {
    executed: boolean;
    passed: boolean;
    attempts: number;
    errors: Array<{
        type: string;
        message: string;
    }>;
    multiAgentAnalysis?: {
        rootCause: string;
        category: string;
        confidence: number;
        suggestedFixes?: string[];
    };
}

/** Un escenario del test case original y si el codigo generado lo verifica. */
export interface ScenarioCoverage {
    /** Paso, criterio o resultado esperado tomado del test case original. */
    scenario: string;
    status: "covered" | "partial" | "missing";
    /** Fragmento del spec (test.step, asercion) que lo cubre. */
    evidence: string;
    gap?: string;
}

/** Cierre del ciclo: el spec generado vs el test case que lo origino. */
export interface FinalValidationResult {
    testCaseId: string;
    /** true solo si ningun escenario quedo en "missing". */
    fullyCovered: boolean;
    coveragePercent: number;
    scenarios: ScenarioCoverage[];
    missingScenarios: string[];
    extraBehaviors: string[];
    verdict: string;
    approvedByHuman?: boolean;
}

export interface GeneratedSpec {
    testCaseId: string;
    title: string;
    kind: TestKind;
    filePath: string;
    /** Page Objects/Components/fixtures nuevos o modificados junto con el spec. */
    supportFiles: string[];
    validation: ValidationResult;
    /** Comparacion final TC original vs codigo generado. */
    finalValidation?: FinalValidationResult;
}

export interface AgentRunResult {
    story: UserStory;
    testCases: TestCase[];
    inventory: ExistingTest[];
    coverage: CoverageItem[];
    generated: GeneratedSpec[];
    artifactsDir: string;
    kindDecisions: KindDecision[];
    humanReview: HumanReviewRound[];
    finalValidations: FinalValidationResult[];
    /** Que aprendio el agente en esta corrida. */
    learning?: SessionLearningSummary;
}

// ---------------------------------------------------------------------------
// Base de conocimiento (agent/knowledge/, versionada en git)
// ---------------------------------------------------------------------------

/** A que tipo de test aplica una pieza de conocimiento. */
export type KnowledgeScope = "ui" | "api" | "both";

export type KnowledgeCategory =
    | "locator"
    | "timing"
    | "assertion"
    | "structure"
    | "import"
    | "http"
    | "data"
    | "domain"
    | "other";

/**
 * Una leccion normativa: "haz X, nunca Y". Es lo que se inyecta en los prompts,
 * asi que se guarda como instruccion imperativa y no como descripcion de un error.
 */
export interface KnowledgeRule {
    id: string;
    scope: KnowledgeScope;
    category: KnowledgeCategory;
    /** La instruccion, en imperativo y autocontenida. */
    rule: string;
    /** Sintoma observable que la motivo: permite al modelo reconocer cuando aplica. */
    trigger: string;
    /** De donde salio: error real reparado, correccion humana, brecha de cobertura. */
    origin: "repair" | "human" | "coverage-gap" | "seed";
    /** Cuantas sesiones distintas la confirmaron. Mas sesiones = mas confianza. */
    confirmations: number;
    /** Veces que el codigo la incumplio DESPUES de haberla aprendido. */
    violationsAfterLearning: number;
    firstSeen: string;
    lastSeen: string;
    /** Claves de las sesiones que la generaron o confirmaron. */
    sessions: string[];
}

/** Solucion de codigo verificada para un problema recurrente. */
export interface KnowledgeRecipe {
    id: string;
    scope: KnowledgeScope;
    /** El problema que resuelve, en una linea. */
    problem: string;
    /** Codigo que ya paso validacion y E2E. */
    code: string;
    /** Donde va: "src/pages", "spec", "src/api/services"... */
    placement: string;
    confirmations: number;
    firstSeen: string;
    lastSeen: string;
    sessions: string[];
}

/**
 * Dato del dominio o del ambiente que el agente NO puede inferir del codigo y
 * que un humano tuvo que aportar (URLs, credenciales de prueba, mensajes exactos).
 *
 * Es la pieza que mas tokens ahorra: evita volver a preguntar lo mismo cada corrida.
 */
export interface KnowledgeFact {
    id: string;
    /** La pregunta que este hecho responde, para poder reusarlo al detectar dudas. */
    question: string;
    answer: string;
    /** Modulo o area a la que aplica ("footer", "checkout", "usuarios"). */
    area: string;
    /** Un hecho aportado por un humano no se sobreescribe con inferencias del LLM. */
    source: "human" | "inferred";
    firstSeen: string;
    lastSeen: string;
    sessions: string[];
}

export interface KnowledgeStats {
    sessions: number;
    specsGenerated: number;
    specsPassedFirstTry: number;
    totalRepairAttempts: number;
    /** Promedio de intentos de reparacion por spec; deberia bajar con el tiempo. */
    averageRepairAttempts: number;
    /** Preguntas al humano evitadas por un hecho ya conocido. */
    questionsAvoidedByFacts: number;
}

export interface KnowledgeBase {
    version: string;
    updatedAt: string;
    rules: KnowledgeRule[];
    recipes: KnowledgeRecipe[];
    facts: KnowledgeFact[];
    stats: KnowledgeStats;
    /** Historial corto de sesiones, para trazabilidad en las revisiones de PR. */
    history: SessionLearningSummary[];
}

/** Lo observado durante una corrida, antes de destilarlo en conocimiento. */
export interface SessionLog {
    sessionKey: string;
    startedAt: string;
    provider: string;
    model: string;
    /** Estructura real que se uso: archivos, fixtures y tipo de cada spec. */
    structure: Array<{
        testCaseId: string;
        kind: TestKind;
        specPath: string;
        supportFiles: string[];
        passedFirstTry: boolean;
        repairAttempts: number;
    }>;
    /** Errores que se repararon, con el codigo antes y despues. */
    repairs: Array<{
        testCaseId: string;
        kind: TestKind;
        errors: string[];
        codeBefore: string;
        codeAfter: string;
    }>;
    /** Respuestas y correcciones del humano: conocimiento que el modelo no puede inferir. */
    humanInput: Array<{
        kind: "answer" | "feedback" | "kind-override";
        question?: string;
        content: string;
        relatedTestCaseIds: string[];
    }>;
    /** Escenarios que el codigo no llego a cubrir. */
    coverageGaps: Array<{ testCaseId: string; missing: string[] }>;
}

/** Resultado de destilar una sesion: que se agrego a la base de conocimiento. */
export interface SessionLearningSummary {
    sessionKey: string;
    date: string;
    specsGenerated: number;
    specsPassedFirstTry: number;
    newRules: number;
    newRecipes: number;
    newFacts: number;
    /** Reglas que ya existian y esta sesion volvio a confirmar. */
    confirmedRules: number;
    /** Reglas que el codigo incumplio aunque ya estaban aprendidas. */
    violatedRules: string[];
    notes: string;
}
