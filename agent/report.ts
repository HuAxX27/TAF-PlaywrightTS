import type { LlmProvider } from "./llm";
import type {
    AgentRunResult,
    CoverageItem,
    CoverageStatus,
    TestCase,
    UserStory,
} from "./types";

const STATUS_LABEL: Record<CoverageStatus, string> = {
    covered: "Cubierto",
    partial: "Parcial",
    missing: "Falta",
};

/** Los test cases en markdown, para revision humana o para subirlos a Jira/Xray/Zephyr. */
export function renderTestCasesMarkdown(story: UserStory, testCases: TestCase[]): string {
    const header = [
        `# Test Cases - ${story.key}`,
        "",
        `**Historia:** ${story.title}`,
        story.url ? `**Jira:** ${story.url}` : "",
        "",
        "## Criterios de aceptacion analizados",
        "",
        ...(story.acceptanceCriteria.length > 0
            ? story.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`)
            : ["_La historia no declara criterios de aceptacion explicitos._"]),
        "",
        "## Test cases propuestos",
        "",
    ];

    const body = testCases.map((testCase) => {
        const lines = [
            `### ${testCase.id} - ${testCase.title}`,
            "",
            `- **Tipo:** ${testCase.kind ? testCase.kind.toUpperCase() : "por clasificar"}`,
            `- **Nivel:** ${testCase.level}`,
            `- **Prioridad:** ${testCase.priority}`,
            `- **Tags:** ${testCase.tags.join(" ") || "-"}`,
            `- **Automatizable:** ${testCase.automatable ? "si" : `no - ${testCase.notAutomatableReason ?? "sin motivo"}`}`,
            "",
            "**Precondiciones**",
            "",
            ...bullets(testCase.preconditions),
            "",
            "**Pasos**",
            "",
            ...testCase.steps.map((step, index) => `${index + 1}. ${step}`),
            "",
            `**Resultado esperado:** ${testCase.expectedResult || "-"}`,
            "",
        ];
        return lines.join("\n");
    });

    return [...header, ...body].join("\n");
}

/** Matriz de trazabilidad test case -> pruebas existentes. */
export function renderCoverageMarkdown(testCases: TestCase[], coverage: CoverageItem[]): string {
    const byId = new Map(testCases.map((testCase) => [testCase.id, testCase]));

    const rows = coverage.map((item) => {
        const testCase = byId.get(item.testCaseId);
        const matched = item.matchedTests.length > 0 ? item.matchedTests.join("<br>") : "-";
        return `| ${item.testCaseId} | ${escapeCell(testCase?.title ?? "")} | ${STATUS_LABEL[item.status]} | ${escapeCell(matched)} | ${escapeCell(item.rationale)} |`;
    });

    return [
        "# Analisis de cobertura",
        "",
        "| Test case | Titulo | Estado | Pruebas existentes | Justificacion |",
        "| --- | --- | --- | --- | --- |",
        ...rows,
        "",
    ].join("\n");
}

/** Resumen ejecutivo de la corrida. */
export function renderReport(result: AgentRunResult, provider: LlmProvider): string {
    const count = (status: CoverageStatus) =>
        result.coverage.filter((item) => item.status === status).length;

    const ok = result.generated.filter((spec) => spec.validation.ok);
    const failed = result.generated.filter((spec) => !spec.validation.ok);
    
    // Estadísticas de validación E2E
    const e2eExecuted = result.generated.filter((spec) => spec.validation.e2eValidation?.executed);
    const e2ePassed = e2eExecuted.filter((spec) => spec.validation.e2eValidation?.passed);

    const uiSpecs = result.generated.filter((spec) => spec.kind === "ui");
    const apiSpecs = result.generated.filter((spec) => spec.kind === "api");

    const fullyCovered = result.finalValidations.filter((item) => item.fullyCovered);
    const answeredQuestions = result.humanReview
        .flatMap((round) => round.questions)
        .filter((question) => question.answeredByHuman);

    return [
        `# Reporte del agente AQA - ${result.story.key}`,
        "",
        `- **Historia:** ${result.story.title}`,
        `- **Proveedor de IA:** ${provider.name} (${provider.model})`,
        `- **Fecha:** ${new Date().toISOString()}`,
        "",
        "## Resumen",
        "",
        `- Test cases disenados: **${result.testCases.length}**`,
        `- Clasificacion: **${result.kindDecisions.filter((item) => item.kind === "ui").length}** UI, **${result.kindDecisions.filter((item) => item.kind === "api").length}** API`,
        `- Pruebas ya existentes en el framework: **${result.inventory.length}**`,
        `- Cobertura: **${count("covered")}** cubiertos, **${count("partial")}** parciales, **${count("missing")}** faltantes`,
        `- Specs generados y validados: **${ok.length}** (UI: ${uiSpecs.length}, API: ${apiSpecs.length})`,
        failed.length > 0 ? `- Specs que NO pasaron validacion: **${failed.length}**` : "",
        e2eExecuted.length > 0
            ? `- Validacion E2E: **${e2ePassed.length}/${e2eExecuted.length}** tests pasaron`
            : "",
        result.finalValidations.length > 0
            ? `- Validacion final contra el test case: **${fullyCovered.length}/${result.finalValidations.length}** cubren todos los escenarios`
            : "",
        `- Preguntas respondidas por el QA: **${answeredQuestions.length}**`,
        "",
        "## Clasificacion UI / API",
        "",
        "| Test case | Tipo | Confianza | Decidio | Justificacion |",
        "| --- | --- | --- | --- | --- |",
        ...result.kindDecisions.map(
            (item) =>
                `| ${item.testCaseId} | ${item.kind.toUpperCase()} | ${item.confidence}% | ${item.decidedBy} | ${escapeCell(item.rationale)} |`
        ),
        "",
        ...renderHumanReviewSection(result),
        "## Specs generados",
        "",
        ...(result.generated.length > 0
            ? result.generated.map((spec) => {
                  const e2e = spec.validation.e2eValidation;
                  const e2eStatus = e2e?.executed
                      ? e2e.passed
                          ? `✓ E2E pasó (${e2e.attempts} intento(s))`
                          : `✗ E2E falló después de ${e2e.attempts} intento(s)`
                      : "";
                  const final = spec.finalValidation;

                  return (
                      `- ${spec.validation.ok ? "[OK]" : "[REVISAR]"} [${spec.kind.toUpperCase()}] \`${spec.filePath}\` - ${spec.testCaseId} ${spec.title}` +
                      (spec.supportFiles.length > 0
                          ? `\n    - Soporte: ${spec.supportFiles.map((file) => `\`${file}\``).join(", ")}`
                          : "") +
                      (e2eStatus ? `\n    - ${e2eStatus}` : "") +
                      (e2e?.multiAgentAnalysis
                          ? `\n    - Análisis: ${e2e.multiAgentAnalysis.rootCause} (confianza: ${e2e.multiAgentAnalysis.confidence}%)`
                          : "") +
                      (final
                          ? `\n    - Cobertura del test case: ${final.coveragePercent}% ${final.fullyCovered ? "(completa)" : `(faltan ${final.missingScenarios.length} escenario(s))`}`
                          : "") +
                      (final && !final.fullyCovered
                          ? `\n    - Sin cubrir: ${final.missingScenarios.slice(0, 3).map(escapeCell).join("; ")}`
                          : "") +
                      (spec.validation.ok
                          ? ""
                          : `\n    - ${spec.validation.errors.slice(0, 3).join("\n    - ")}`)
                  );
              })
            : ["_No se genero ningun spec en esta corrida._"]),
        "",
        result.finalValidations.length > 0
            ? "Detalle escenario por escenario en `06-final-validation.md`."
            : "",
        "",
        "## Siguiente paso",
        "",
        e2eExecuted.length > 0 && e2ePassed.length === e2eExecuted.length
            ? "1. ✓ Todos los tests pasaron validación E2E - listos para usar"
            : "1. Revisar los specs generados: los locators y aserciones necesitan ojo humano.",
        e2eExecuted.length === 0
            ? "   Se identifican por el comentario `// Generado por el Agente AQA` al tope del archivo."
            : "",
        result.finalValidations.length > fullyCovered.length
            ? `2. Completar los ${result.finalValidations.length - fullyCovered.length} spec(s) con cobertura incompleta (anotados en el encabezado del archivo).`
            : e2eExecuted.length === 0 || e2ePassed.length < e2eExecuted.length
              ? "2. Correr `npx playwright test` contra el ambiente real."
              : "2. Integrar los tests en tu suite de regresión.",
        "3. Quitar el comentario de marca una vez aprobado el spec.",
        "",
    ]
        .filter((line) => line !== "")
        .join("\n");
}

/** Trazabilidad de lo que el humano aporto: preguntas respondidas y cambios pedidos. */
function renderHumanReviewSection(result: AgentRunResult): string[] {
    const answers = result.humanReview
        .flatMap((round) => round.questions)
        .filter((question) => question.answeredByHuman);
    const feedback = result.humanReview
        .map((round) => round.feedback)
        .filter((item): item is string => Boolean(item));

    if (answers.length === 0 && feedback.length === 0) return [];

    const lines = ["## Aportes del QA", ""];

    if (answers.length > 0) {
        lines.push(
            "| Pregunta del agente | Respuesta del QA | Afecta a |",
            "| --- | --- | --- |",
            ...answers.map(
                (item) =>
                    `| ${escapeCell(item.question)} | ${escapeCell(item.answer)} | ${item.relatedTestCaseIds.join(", ") || "-"} |`
            ),
            ""
        );
    }

    if (feedback.length > 0) {
        lines.push("**Cambios pedidos durante la revision**", "", ...feedback.map((item) => `- ${item}`), "");
    }

    return lines;
}

function bullets(items: string[]): string[] {
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["- -"];
}

function escapeCell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
