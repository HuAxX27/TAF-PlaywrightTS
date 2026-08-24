import { extractJson, type LlmProvider } from "../llm";
import { classifyPrompt, SYSTEM_PROMPT } from "../prompts";
import type { KindDecision, TestCase, TestKind } from "../types";

/**
 * Clasifica cada test case como UI o API.
 *
 * Es la decision que determina convenciones, carpeta destino y prompt de
 * codegen, asi que primero se intenta resolver con senales duras (nivel del TC,
 * tags, vocabulario HTTP) y solo los casos ambiguos se le mandan al LLM.
 */

const API_SIGNALS =
    /\b(api|endpoint|endpoints|servicio|service|request|response|payload|http|https?\s+status|status\s?code|get|post|put|patch|delete|rest|graphql|json|schema|header|headers|token|bearer|oauth|swagger|contrato|contract|microservicio)\b/i;

const UI_SIGNALS =
    /\b(pantalla|navegador|browser|click|clic|hacer\s+clic|boton|bot[oó]n|formulario|input|campo|men[uú]|modal|popup|banner|footer|header|scroll|visible|se\s+muestra|se\s+visualiza|ver|pagina|p[aá]gina|link|enlace|hover|seleccionar|llenar|escribir|navegar\s+a|redirige|url|titulo|t[ií]tulo|texto)\b/i;

/** Verbos HTTP explicitos al inicio de un paso: senal muy fuerte de API. */
const HTTP_VERB_STEP = /^\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/?\S/;

interface HeuristicVerdict {
    kind: TestKind;
    confidence: number;
    rationale: string;
}

/** Devuelve un veredicto solo cuando las senales son claras; si no, null. */
function classifyByHeuristics(testCase: TestCase): HeuristicVerdict | null {
    const tags = testCase.tags.map((tag) => tag.replace(/^@/, "").toLowerCase());

    if (tags.includes("api") || testCase.level === "api") {
        return {
            kind: "api",
            confidence: 95,
            rationale: 'El test case declara nivel "api" o el tag @api.',
        };
    }

    if (
        tags.includes("ui") ||
        tags.includes("e2e") ||
        testCase.level === "visual" ||
        testCase.level === "a11y"
    ) {
        return {
            kind: "ui",
            confidence: 90,
            rationale: `El test case declara nivel "${testCase.level}" o un tag de UI.`,
        };
    }

    const steps = testCase.steps;
    if (steps.length > 0 && steps.every((step) => HTTP_VERB_STEP.test(step))) {
        return {
            kind: "api",
            confidence: 92,
            rationale: "Todos los pasos son llamadas HTTP explicitas (verbo + ruta).",
        };
    }

    const text = [
        testCase.title,
        ...testCase.preconditions,
        ...steps,
        testCase.expectedResult,
    ].join(" ");
    const apiHits = countMatches(text, API_SIGNALS);
    const uiHits = countMatches(text, UI_SIGNALS);

    // Un margen amplio evita clasificar por una sola palabra suelta ("token",
    // "url") que aparece igual en tests de UI.
    if (apiHits >= 2 && apiHits >= uiHits * 3) {
        return {
            kind: "api",
            confidence: 80,
            rationale: `Vocabulario de servicios dominante (${apiHits} senales de API vs ${uiHits} de UI).`,
        };
    }

    if (uiHits >= 2 && uiHits >= apiHits * 3) {
        return {
            kind: "ui",
            confidence: 80,
            rationale: `Vocabulario de interfaz dominante (${uiHits} senales de UI vs ${apiHits} de API).`,
        };
    }

    return null;
}

function countMatches(text: string, pattern: RegExp): number {
    const global = new RegExp(pattern.source, "gi");
    const words = new Set(text.match(global)?.map((word) => word.toLowerCase()) ?? []);
    return words.size;
}

/**
 * Clasifica todos los test cases. Los que la heuristica resuelve no gastan
 * tokens; el resto se resuelve en una sola llamada al LLM.
 */
export async function classifyTestCases(
    provider: LlmProvider,
    testCases: TestCase[]
): Promise<KindDecision[]> {
    const decisions = new Map<string, KindDecision>();
    const ambiguous: TestCase[] = [];

    for (const testCase of testCases) {
        // Una fuente que ya trae kind explicito (JSON local, Xray) manda.
        if (testCase.kind) {
            decisions.set(testCase.id, {
                testCaseId: testCase.id,
                kind: testCase.kind,
                confidence: 100,
                rationale: "El test case de origen ya declara su tipo.",
                decidedBy: "heuristic",
            });
            continue;
        }

        const verdict = classifyByHeuristics(testCase);
        if (verdict) {
            decisions.set(testCase.id, {
                testCaseId: testCase.id,
                kind: verdict.kind,
                confidence: verdict.confidence,
                rationale: verdict.rationale,
                decidedBy: "heuristic",
            });
        } else {
            ambiguous.push(testCase);
        }
    }

    if (ambiguous.length > 0) {
        for (const decision of await classifyWithLlm(provider, ambiguous)) {
            decisions.set(decision.testCaseId, decision);
        }
    }

    return testCases.map(
        (testCase) =>
            decisions.get(testCase.id) ?? {
                testCaseId: testCase.id,
                kind: "ui",
                confidence: 40,
                rationale: "Sin senales concluyentes; se asume UI por ser el caso mas comun.",
                decidedBy: "heuristic",
            }
    );
}

async function classifyWithLlm(
    provider: LlmProvider,
    testCases: TestCase[]
): Promise<KindDecision[]> {
    let parsed: Array<Partial<KindDecision>>;

    try {
        const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: classifyPrompt(testCases),
        });
        parsed = extractJson<Array<Partial<KindDecision>>>(raw);
    } catch (error) {
        // Una clasificacion fallida no debe tumbar la corrida: cae a UI, que el
        // humano puede corregir en la etapa de revision.
        console.warn(
            `     ! no se pudo clasificar con el LLM (${error instanceof Error ? error.message : String(error)}); se asume UI.`
        );
        parsed = [];
    }

    const byId = new Map(parsed.map((item) => [item.testCaseId, item]));

    return testCases.map((testCase) => {
        const item = byId.get(testCase.id);
        const kind: TestKind = item?.kind === "api" ? "api" : "ui";
        return {
            testCaseId: testCase.id,
            kind,
            confidence: clampConfidence(item?.confidence),
            rationale: item?.rationale?.trim() || "El modelo no justifico la clasificacion.",
            decidedBy: "llm",
        };
    });
}

function clampConfidence(value: number | undefined): number {
    if (!Number.isFinite(value)) return 50;
    return Math.min(100, Math.max(0, Math.round(value as number)));
}
