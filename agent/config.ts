import * as path from "path";
import * as dotenv from "dotenv";

// El toolkit consume la salida de sus helpers como JSON. Evita que dotenv mezcle
// banners informativos con ese canal de maquina.
dotenv.config({ quiet: true });

const ROOT = path.resolve(__dirname, "..");

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
    /** Los specs nuevos viven aqui hasta que un QA los promueve a la suite aprobada. */
    candidatesDir: resolveFromRoot(process.env.CANDIDATES_DIR, "tests/candidates"),
    artifactsDir: resolveFromRoot(process.env.ARTIFACTS_DIR, "agent/artifacts"),
    fixturesPath: resolveFromRoot(process.env.FIXTURES_PATH, "src/fixtures/test.ts"),

    timeoutMs: num(process.env.AQA_TIMEOUT_MS, 120_000),
    /** Tope del bundle que reciben los agentes de codegen y reparación. */
    maxContextChars: num(process.env.MAX_CONTEXT_CHARS, 24_000),
    /** Máximo de ciclos diagnóstico → propuesta → revisión → revalidación. */
    maxE2ERepairAttempts: num(process.env.MAX_E2E_REPAIR_ATTEMPTS, 3),
    /** Debajo de esta confianza, la clasificación UI/API se confirma con el humano. */
    kindConfidenceThreshold: num(process.env.KIND_CONFIDENCE_THRESHOLD, 80),
    /** Tope de caracteres de conocimiento precargado por scope. */
    knowledgeContextChars: num(process.env.KNOWLEDGE_CONTEXT_CHARS, 6_000),
    maxRulesInPrompt: num(process.env.MAX_RULES_IN_PROMPT, 12),
    maxRecipesInPrompt: num(process.env.MAX_RECIPES_IN_PROMPT, 3),
    /** Techo por sesión: obliga a que el modelo priorice en vez de inflar la base. */
    maxNewRulesPerSession: num(process.env.MAX_NEW_RULES_PER_SESSION, 5),
    maxNewFactsPerSession: num(process.env.MAX_NEW_FACTS_PER_SESSION, 10),
};
