import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

export const ROOT = path.resolve(__dirname, "..");

function resolveFromRoot(value: string | undefined, fallback: string): string {
    return path.resolve(ROOT, value && value.trim() ? value : fallback);
}

function num(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && value !== undefined && value !== "" ? parsed : fallback;
}

export const agentConfig = {
    root: ROOT,
    testsDir: resolveFromRoot(process.env.TESTS_DIR, "tests"),
    artifactsDir: resolveFromRoot(process.env.ARTIFACTS_DIR, "agent/artifacts"),
    storyDir: resolveFromRoot(process.env.STORY_DIR, "agent/stories"),
    testCaseDir: resolveFromRoot(process.env.TESTCASE_DIR, "agent/testcases"),
    fixturesPath: resolveFromRoot(process.env.FIXTURES_PATH, "src/fixtures/test.ts"),

    storySource: process.env.STORY_SOURCE ?? "file",
    testCaseSource: process.env.TESTCASE_SOURCE ?? "file",
    provider: process.env.LLM_PROVIDER ?? "mock",

    temperature: num(process.env.LLM_TEMPERATURE, 0.2),
    timeoutMs: num(process.env.LLM_TIMEOUT_MS, 120_000),
    maxRepairAttempts: num(process.env.MAX_REPAIR_ATTEMPTS, 2),
    /** Tope de caracteres de contexto del framework que se manda al LLM. */
    maxContextChars: num(process.env.MAX_CONTEXT_CHARS, 24_000),
    /** Habilitar validación E2E ejecutando tests contra la app real (habilitado por defecto). */
    enableE2EValidation: process.env.ENABLE_E2E_VALIDATION !== "false",
    /** Máximo de intentos de reparación E2E con multiagentes. */
    maxE2ERepairAttempts: num(process.env.MAX_E2E_REPAIR_ATTEMPTS, 3),

    /**
     * El agente pregunta y espera aprobación humana. Se apaga con --yes o
     * INTERACTIVE=false para que el pipeline siga siendo scriptable en CI.
     */
    interactive: process.env.INTERACTIVE !== "false" && !process.env.CI,
    /** Rondas máximas de revisión humana antes de cortar el ciclo. */
    maxReviewRounds: num(process.env.MAX_REVIEW_ROUNDS, 5),
    /** Debajo de esta confianza, la clasificación UI/API se confirma con el humano. */
    kindConfidenceThreshold: num(process.env.KIND_CONFIDENCE_THRESHOLD, 80),
    /** Comparar el test case original contra el código generado al cerrar. */
    enableFinalValidation: process.env.ENABLE_FINAL_VALIDATION !== "false",

    /**
     * Aprendizaje: al cerrar cada sesión se destila lo aprendido en
     * agent/knowledge/ (versionado en git). Cuesta una llamada al LLM por corrida
     * y ahorra tokens en todas las siguientes.
     */
    enableLearning: process.env.ENABLE_LEARNING !== "false",
    /** Tope de caracteres de conocimiento inyectado por prompt. */
    knowledgeContextChars: num(process.env.KNOWLEDGE_CONTEXT_CHARS, 6_000),
    maxRulesInPrompt: num(process.env.MAX_RULES_IN_PROMPT, 12),
    maxRecipesInPrompt: num(process.env.MAX_RECIPES_IN_PROMPT, 3),
    maxFactsInPrompt: num(process.env.MAX_FACTS_IN_PROMPT, 15),
    /** Techo por sesión: obliga a que el modelo priorice en vez de inflar la base. */
    maxNewRulesPerSession: num(process.env.MAX_NEW_RULES_PER_SESSION, 5),
    maxNewFactsPerSession: num(process.env.MAX_NEW_FACTS_PER_SESSION, 10),
};

export type AgentConfig = typeof agentConfig;
