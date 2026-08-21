import type { LlmProvider } from "./llm";
import type { AgentRunResult, CoverageItem, CoverageStatus, TestCase, UserStory } from "./types";

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
        `- Pruebas ya existentes en el framework: **${result.inventory.length}**`,
        `- Cobertura: **${count("covered")}** cubiertos, **${count("partial")}** parciales, **${count("missing")}** faltantes`,
        `- Specs generados y validados: **${ok.length}**`,
        failed.length > 0 ? `- Specs que NO pasaron validacion: **${failed.length}**` : "",
        "",
        "## Specs generados",
        "",
        ...(result.generated.length > 0
            ? result.generated.map(
                  (spec) =>
                      `- ${spec.validation.ok ? "[OK]" : "[REVISAR]"} \`${spec.filePath}\` - ${spec.testCaseId} ${spec.title}` +
                      (spec.supportFiles.length > 0
                          ? `\n    - Soporte: ${spec.supportFiles.map((file) => `\`${file}\``).join(", ")}`
                          : "") +
                      (spec.validation.ok
                          ? ""
                          : `\n    - ${spec.validation.errors.slice(0, 3).join("\n    - ")}`)
              )
            : ["_No se genero ningun spec en esta corrida._"]),
        "",
        "## Siguiente paso",
        "",
        "1. Revisar los specs generados: los locators y aserciones necesitan ojo humano.",
        "   Se identifican por el comentario `// Generado por el Agente AQA` al tope del archivo.",
        "2. Correr `npx playwright test` contra el ambiente real.",
        "3. Quitar el comentario de marca una vez aprobado el spec.",
        "",
    ]
        .filter((line) => line !== "")
        .join("\n");
}

function bullets(items: string[]): string[] {
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["- -"];
}

function escapeCell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
