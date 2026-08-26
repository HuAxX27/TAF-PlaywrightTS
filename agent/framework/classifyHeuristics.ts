import type { TestCase, TestKind } from "../types";

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

/** Clasificacion determinista; devuelve null cuando debe decidir un especialista. */
export function classifyByHeuristics(testCase: TestCase): HeuristicVerdict | null {
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
