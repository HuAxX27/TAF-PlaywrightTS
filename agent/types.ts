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

/** Un Test Case en lenguaje de negocio, antes de existir como codigo. */
export interface TestCase {
    id: string;
    title: string;
    level: TestLevel;
    priority: TestPriority;
    tags: string[];
    preconditions: string[];
    steps: string[];
    expectedResult: string;
    automatable: boolean;
    notAutomatableReason?: string;
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
}

export interface GeneratedSpec {
    testCaseId: string;
    title: string;
    filePath: string;
    validation: ValidationResult;
}

export interface AgentRunResult {
    story: UserStory;
    testCases: TestCase[];
    inventory: ExistingTest[];
    coverage: CoverageItem[];
    generated: GeneratedSpec[];
    artifactsDir: string;
}
