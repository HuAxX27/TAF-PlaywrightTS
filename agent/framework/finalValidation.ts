import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";
import { extractJson, type LlmProvider } from "../llm";
import { finalValidationPrompt, SYSTEM_PROMPT } from "../prompts";
import type { FinalValidationResult, ScenarioCoverage, TestCase } from "../types";

/**
 * Cierre del ciclo: compara el test case ORIGINAL contra el codigo realmente
 * escrito y reporta que escenario quedo sin cubrir.
 *
 * Que el spec compile y pase no significa que pruebe lo que el TC pedia: el
 * modelo puede haber omitido un paso o aflojado una asercion durante la
 * reparacion. Esta etapa es la unica que detecta esa deriva.
 */
export async function validateAgainstTestCase(
    provider: LlmProvider,
    testCase: TestCase,
    specPath: string,
    supportRelPaths: string[]
): Promise<FinalValidationResult> {
    const specContent = fs.readFileSync(specPath, "utf-8");
    const supportFiles = supportRelPaths
        .map((relPath) => path.join(agentConfig.root, relPath))
        .filter((absPath) => fs.existsSync(absPath))
        .map((absPath) => ({
            path: path.relative(agentConfig.root, absPath).replace(/\\/g, "/"),
            content: fs.readFileSync(absPath, "utf-8"),
        }));

    try {
        const raw = await provider.complete({
            system: SYSTEM_PROMPT,
            prompt: finalValidationPrompt(testCase, specContent, supportFiles),
        });
        return normalize(testCase, extractJson<Partial<FinalValidationResult>>(raw));
    } catch (error) {
        // Sin veredicto del modelo no se puede afirmar cobertura completa.
        return {
            testCaseId: testCase.id,
            fullyCovered: false,
            coveragePercent: 0,
            scenarios: [],
            missingScenarios: [],
            extraBehaviors: [],
            verdict: `No se pudo validar contra el test case original: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function normalize(
    testCase: TestCase,
    parsed: Partial<FinalValidationResult>
): FinalValidationResult {
    const scenarios: ScenarioCoverage[] = (parsed.scenarios ?? []).map((scenario) => ({
        scenario: scenario.scenario?.trim() || "(escenario sin nombre)",
        status:
            scenario.status === "covered" || scenario.status === "partial"
                ? scenario.status
                : "missing",
        evidence: scenario.evidence?.trim() || "",
        gap: scenario.gap?.trim() || undefined,
    }));

    const missingScenarios = scenarios
        .filter((scenario) => scenario.status !== "covered")
        .map((scenario) => scenario.gap ?? scenario.scenario);

    const declaredMissing = (parsed.missingScenarios ?? []).map((item) => String(item).trim());
    const allMissing = [...new Set([...missingScenarios, ...declaredMissing])].filter(Boolean);

    // El porcentaje se recalcula del detalle: un total que no cuadra con los
    // escenarios listados es peor que no tener numero.
    const coveragePercent =
        scenarios.length > 0
            ? Math.round(
                  (scenarios.reduce(
                      (sum, scenario) =>
                          sum + (scenario.status === "covered" ? 1 : scenario.status === "partial" ? 0.5 : 0),
                      0
                  ) /
                      scenarios.length) *
                      100
              )
            : 0;

    return {
        testCaseId: testCase.id,
        fullyCovered: scenarios.length > 0 && allMissing.length === 0,
        coveragePercent,
        scenarios,
        missingScenarios: allMissing,
        extraBehaviors: (parsed.extraBehaviors ?? []).map((item) => String(item).trim()).filter(Boolean),
        verdict: parsed.verdict?.trim() || "El modelo no emitio veredicto.",
    };
}

/** Reporte markdown de la validacion final, listo para adjuntar al TC en Jira/Xray. */
export function renderFinalValidationMarkdown(
    testCases: TestCase[],
    validations: FinalValidationResult[]
): string {
    const byId = new Map(testCases.map((testCase) => [testCase.id, testCase]));

    const sections = validations.map((validation) => {
        const testCase = byId.get(validation.testCaseId);
        const lines = [
            `## ${validation.testCaseId} - ${testCase?.title ?? ""}`,
            "",
            `- **Tipo:** ${(testCase?.kind ?? "ui").toUpperCase()}`,
            `- **Cobertura del test case:** ${validation.coveragePercent}%`,
            `- **Cubre todos los escenarios:** ${validation.fullyCovered ? "si" : "NO"}`,
            validation.approvedByHuman !== undefined
                ? `- **Aprobado por el humano:** ${validation.approvedByHuman ? "si" : "no"}`
                : "",
            "",
            `**Veredicto:** ${validation.verdict}`,
            "",
            "| Escenario del test case | Estado | Evidencia en el codigo | Brecha |",
            "| --- | --- | --- | --- |",
            ...validation.scenarios.map(
                (scenario) =>
                    `| ${cell(scenario.scenario)} | ${STATUS_LABEL[scenario.status]} | ${cell(scenario.evidence)} | ${cell(scenario.gap ?? "-")} |`
            ),
            "",
        ];

        if (validation.missingScenarios.length > 0) {
            lines.push(
                "**Escenarios sin cubrir**",
                "",
                ...validation.missingScenarios.map((item) => `- ${item}`),
                ""
            );
        }

        if (validation.extraBehaviors.length > 0) {
            lines.push(
                "**Comportamientos que el codigo valida y el test case no pedia**",
                "",
                ...validation.extraBehaviors.map((item) => `- ${item}`),
                ""
            );
        }

        return lines.filter((line) => line !== "").join("\n");
    });

    return [
        "# Validacion final: test case original vs codigo generado",
        "",
        ...(sections.length > 0 ? sections : ["_No se ejecuto la validacion final en esta corrida._"]),
        "",
    ].join("\n\n");
}

const STATUS_LABEL: Record<ScenarioCoverage["status"], string> = {
    covered: "Cubierto",
    partial: "Parcial",
    missing: "Falta",
};

function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "-";
}
