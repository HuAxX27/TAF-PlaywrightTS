import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";
import { extractJson, type LlmProvider } from "../llm";
import { distillPrompt, SYSTEM_PROMPT } from "../prompts";
import type {
    HumanReviewRound,
    KnowledgeBase,
    SessionLearningSummary,
    SessionLog,
    TestKind,
} from "../types";
import {
    knowledgeFilePath,
    loadKnowledge,
    mergeDistilled,
    renderKnowledgeMarkdown,
    saveKnowledge,
    updateStats,
    type DistilledKnowledge,
} from "./knowledge";

/**
 * Aprendizaje del agente.
 *
 * Este modulo hace dos cosas: acumula lo que pasa durante una corrida
 * (`SessionRecorder`) y al cerrar la destila en conocimiento reutilizable que se
 * guarda en `agent/knowledge/`, versionado en git.
 *
 * La destilacion es una sola llamada al LLM al final, no una por evento: el punto
 * del sistema es gastar menos tokens en las siguientes corridas, no gastar mas en
 * esta.
 */

/** Tope de caracteres de codigo que se manda por reparacion al destilar. */
const CODE_EXCERPT_CHARS = 2_500;

export class SessionRecorder {
    private readonly log: SessionLog;

    constructor(sessionKey: string, provider: LlmProvider) {
        this.log = {
            sessionKey,
            startedAt: new Date().toISOString(),
            provider: provider.name,
            model: provider.model,
            structure: [],
            repairs: [],
            humanInput: [],
            coverageGaps: [],
        };
    }

    /** La estructura real que se uso: es lo que permite converger a un patron estable. */
    recordSpec(entry: SessionLog["structure"][number]): void {
        this.log.structure.push(entry);
    }

    /**
     * Un error reparado con el antes y el despues. El diff es la unica forma de
     * deducir la regla que habria evitado el error desde el principio.
     */
    recordRepair(
        testCaseId: string,
        kind: TestKind,
        errors: string[],
        codeBefore: string,
        codeAfter: string
    ): void {
        if (errors.length === 0) return;

        this.log.repairs.push({
            testCaseId,
            kind,
            errors: errors.slice(0, 5).map((error) => firstLines(error, 3)),
            codeBefore: excerpt(codeBefore),
            codeAfter: excerpt(codeAfter),
        });
    }

    recordCoverageGap(testCaseId: string, missing: string[]): void {
        if (missing.length === 0) return;
        this.log.coverageGaps.push({ testCaseId, missing });
    }

    /** Todo lo que aporto el humano: respuestas, feedback y correcciones de tipo. */
    recordHumanReview(rounds: HumanReviewRound[]): void {
        for (const round of rounds) {
            for (const question of round.questions) {
                if (!question.answeredByHuman) continue;
                this.log.humanInput.push({
                    kind: "answer",
                    question: question.question,
                    content: question.answer,
                    relatedTestCaseIds: question.relatedTestCaseIds,
                });
            }

            if (round.feedback?.trim()) {
                this.log.humanInput.push({
                    kind: "feedback",
                    content: round.feedback.trim(),
                    relatedTestCaseIds: [],
                });
            }
        }
    }

    recordKindOverride(testCaseId: string, kind: TestKind): void {
        this.log.humanInput.push({
            kind: "kind-override",
            content: `El QA reclasifico ${testCaseId} como ${kind.toUpperCase()}.`,
            relatedTestCaseIds: [testCaseId],
        });
    }

    snapshot(): SessionLog {
        return this.log;
    }

    /** Una sesion sin especs ni aportes humanos no tiene nada que ensenar. */
    hasSomethingToLearn(): boolean {
        return (
            this.log.repairs.length > 0 ||
            this.log.humanInput.length > 0 ||
            this.log.coverageGaps.length > 0 ||
            this.log.structure.length > 0
        );
    }
}

// ---------------------------------------------------------------------------
// Cierre de sesion: destilar y persistir
// ---------------------------------------------------------------------------

/**
 * Convierte la sesion en conocimiento y lo guarda en el repo.
 *
 * Las estadisticas se actualizan siempre (aunque el LLM no aporte lecciones)
 * porque son la forma de saber si el sistema esta mejorando de verdad.
 */
export async function closeSessionLearning(
    provider: LlmProvider,
    recorder: SessionRecorder
): Promise<SessionLearningSummary> {
    const session = recorder.snapshot();
    const knowledge = loadKnowledge();

    const specsGenerated = session.structure.length;
    const specsPassedFirstTry = session.structure.filter((item) => item.passedFirstTry).length;
    const repairAttempts = session.structure.reduce((sum, item) => sum + item.repairAttempts, 0);

    let distilled: DistilledKnowledge = {
        rules: [],
        recipes: [],
        facts: [],
        violatedRules: [],
        notes: "",
    };

    if (agentConfig.enableLearning && recorder.hasSomethingToLearn()) {
        distilled = await distill(provider, session, knowledge);
    } else if (!agentConfig.enableLearning) {
        console.log("     aprendizaje desactivado (ENABLE_LEARNING=false)");
    }

    const merged = mergeDistilled(knowledge, distilled, session.sessionKey);
    updateStats(knowledge, specsGenerated, specsPassedFirstTry, repairAttempts);

    const summary: SessionLearningSummary = {
        sessionKey: session.sessionKey,
        date: new Date().toISOString(),
        specsGenerated,
        specsPassedFirstTry,
        newRules: merged.newRules,
        newRecipes: merged.newRecipes,
        newFacts: merged.newFacts,
        confirmedRules: merged.confirmedRules,
        violatedRules: distilled.violatedRules,
        notes: distilled.notes,
    };

    knowledge.history.push(summary);
    saveKnowledge(knowledge);

    return summary;
}

async function distill(
    provider: LlmProvider,
    session: SessionLog,
    knowledge: KnowledgeBase
): Promise<DistilledKnowledge> {
    try {
        const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: distillPrompt(session, knowledge),
        });
        return normalizeDistilled(extractJson<Partial<DistilledKnowledge>>(raw));
    } catch (error) {
        // Fallar al aprender no puede invalidar una corrida que genero tests validos.
        console.warn(
            `     ! no se pudo destilar el aprendizaje (${error instanceof Error ? error.message : String(error)}); las estadisticas si se guardan.`
        );
        return { rules: [], recipes: [], facts: [], violatedRules: [], notes: "" };
    }
}

/**
 * Filtra lo que el modelo devuelve. Dos criterios: descartar lo que ya esta en
 * las convenciones (repetirlo solo gasta tokens) y no dejar entrar secretos, que
 * este archivo se commitea.
 */
function normalizeDistilled(parsed: Partial<DistilledKnowledge>): DistilledKnowledge {
    const rules = (parsed.rules ?? [])
        .filter((rule) => rule?.rule?.trim() && rule.rule.trim().length > 20)
        .filter((rule) => !isRestatingConventions(rule.rule))
        .slice(0, agentConfig.maxNewRulesPerSession)
        .map((rule) => ({
            scope: normalizeScope(rule.scope),
            category: rule.category ?? "other",
            rule: rule.rule.trim(),
            trigger: rule.trigger?.trim() || "Sin sintoma declarado.",
            origin: normalizeOrigin(rule.origin),
        }));

    const recipes = (parsed.recipes ?? [])
        .filter((recipe) => recipe?.problem?.trim() && recipe?.code?.trim())
        .slice(0, 2)
        .map((recipe) => ({
            scope: normalizeScope(recipe.scope),
            problem: recipe.problem.trim(),
            code: recipe.code.trim(),
            placement: recipe.placement?.trim() || "src/pages",
        }));

    const facts = (parsed.facts ?? [])
        .filter((fact) => fact?.question?.trim() && fact?.answer?.trim())
        .filter((fact) => !looksLikeSecret(`${fact.question} ${fact.answer}`))
        .slice(0, agentConfig.maxNewFactsPerSession)
        .map((fact) => ({
            question: fact.question.trim(),
            answer: fact.answer.trim(),
            area: fact.area?.trim().toLowerCase() || "general",
        }));

    return {
        rules,
        recipes,
        facts,
        violatedRules: (parsed.violatedRules ?? []).map((id) => String(id).trim()).filter(Boolean),
        notes: parsed.notes?.trim() ?? "",
    };
}

function normalizeScope(scope: unknown): "ui" | "api" | "both" {
    return scope === "ui" || scope === "api" ? scope : "both";
}

function normalizeOrigin(origin: unknown): "repair" | "human" | "coverage-gap" | "seed" {
    return origin === "human" || origin === "coverage-gap" || origin === "seed" ? origin : "repair";
}

/**
 * Lo que ya vive en CONVENTIONS*.md no aporta nada como "leccion aprendida":
 * el modelo ya lo recibe en cada prompt de codegen.
 */
const CONVENTION_ECHOES = [
    /\buse?a?r?\s+test\.step\b/i,
    /\bgetbyrole\b.*\b(en (lugar|vez) de|no)\b/i,
    /\bimport(a|ar)?\b.*\bfixture\b/i,
    /\bno\s+us(es|ar)\s+waitfortimeout\b/i,
    /\bno\s+us(es|ar)\s+selectores?\s+css\b/i,
    /\btypescript\s+strict\b/i,
    /\btags?\s+inline\b/i,
];

function isRestatingConventions(rule: string): boolean {
    return CONVENTION_ECHOES.some((pattern) => pattern.test(rule));
}

/** Barrera de seguridad: la base de conocimiento se commitea al repo. */
const SECRET_HINTS =
    /\b(password|passwd|contrase|secret|api[_-]?key|token|bearer|credential|client[_-]?secret|private[_-]?key)\b/i;

function looksLikeSecret(text: string): boolean {
    return SECRET_HINTS.test(text);
}

function excerpt(code: string): string {
    return code.length <= CODE_EXCERPT_CHARS
        ? code
        : `${code.slice(0, CODE_EXCERPT_CHARS)}\n/* ...truncado... */`;
}

function firstLines(text: string, count: number): string {
    return text
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .slice(0, count)
        .join(" ")
        .slice(0, 400);
}

// ---------------------------------------------------------------------------
// Reportes y utilidades de CLI
// ---------------------------------------------------------------------------

/** Reporte legible de la base de conocimiento (`--learning-report`). */
export function generateLearningReport(): string {
    return renderKnowledgeMarkdown(loadKnowledge());
}

/**
 * Migra la base vieja (`agent/artifacts/learning-database.json`) al formato nuevo.
 *
 * Del formato v1 solo se rescatan los contadores: sus "patrones exitosos" eran
 * tautologias derivadas de buscar substrings en el codigo ("contiene test.step"
 * -> "usa test.step"), que es exactamente lo que este rediseno elimina.
 */
export function migrateLegacyDatabase(): string | undefined {
    const legacyPath = path.join(agentConfig.artifactsDir, "learning-database.json");
    if (!fs.existsSync(legacyPath)) return undefined;
    if (fs.existsSync(knowledgeFilePath())) return undefined;

    interface LegacyDb {
        statistics?: {
            totalGenerations?: number;
            successfulGenerations?: number;
            averageRepairAttempts?: number;
        };
    }

    try {
        const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf-8")) as LegacyDb;
        const knowledge = loadKnowledge();
        const total = legacy.statistics?.totalGenerations ?? 0;

        knowledge.stats.specsGenerated = total;
        knowledge.stats.specsPassedFirstTry = legacy.statistics?.successfulGenerations ?? 0;
        knowledge.stats.averageRepairAttempts = legacy.statistics?.averageRepairAttempts ?? 0;
        knowledge.stats.totalRepairAttempts = Math.round(
            (legacy.statistics?.averageRepairAttempts ?? 0) * total
        );

        saveKnowledge(knowledge);
        return `Estadisticas migradas de ${total} generacion(es) previas.`;
    } catch {
        return undefined;
    }
}
