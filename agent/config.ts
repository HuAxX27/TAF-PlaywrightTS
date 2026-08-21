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
};

export type AgentConfig = typeof agentConfig;
