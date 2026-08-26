export interface XrayRunContext {
    selector: string;
    label: string;
    url?: string;
}

export type TestPriority = "critical" | "high" | "medium" | "low";
export type TestLevel = "e2e" | "api" | "visual" | "a11y";
export type TestKind = "ui" | "api";

/** Test Case normalizado que Xray entrega al pipeline. */
export interface TestCase {
    id: string;
    title: string;
    level: TestLevel;
    kind?: TestKind;
    priority: TestPriority;
    tags: string[];
    preconditions: string[];
    steps: string[];
    expectedResult: string;
    automatable: boolean;
    notAutomatableReason?: string;
}

export interface ExistingTest {
    title: string;
    file: string;
    line?: number;
    tags: string[];
}

export type KnowledgeScope = "ui" | "api" | "both";

export type KnowledgeCategory =
    | "locator"
    | "navigation"
    | "timing"
    | "assertion"
    | "structure"
    | "import"
    | "http"
    | "data"
    | "domain"
    | "other";

export interface KnowledgeRule {
    id: string;
    scope: KnowledgeScope;
    category: KnowledgeCategory;
    rule: string;
    trigger: string;
    origin: "repair" | "human" | "coverage-gap" | "seed";
    confirmations: number;
    violationsAfterLearning: number;
    firstSeen: string;
    lastSeen: string;
    sessions: string[];
}

export interface KnowledgeRecipe {
    id: string;
    scope: KnowledgeScope;
    problem: string;
    code: string;
    placement: string;
    confirmations: number;
    firstSeen: string;
    lastSeen: string;
    sessions: string[];
}

export interface KnowledgeFact {
    id: string;
    question: string;
    answer: string;
    area: string;
    source: "human";
    firstSeen: string;
    lastSeen: string;
    sessions: string[];
}

export interface KnowledgeStats {
    sessions: number;
    specsGenerated: number;
    specsPassedFirstTry: number;
    totalRepairAttempts: number;
    averageRepairAttempts: number;
    questionsAvoidedByFacts: number;
}

export interface SessionLearningSummary {
    sessionKey: string;
    date: string;
    specsGenerated: number;
    specsPassedFirstTry: number;
    newRules: number;
    newRecipes: number;
    newFacts: number;
    confirmedRules: number;
    violatedRules: string[];
    notes: string;
}

export interface KnowledgeBase {
    version: string;
    updatedAt: string;
    rules: KnowledgeRule[];
    recipes: KnowledgeRecipe[];
    facts: KnowledgeFact[];
    stats: KnowledgeStats;
    history: SessionLearningSummary[];
}
