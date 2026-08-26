import type { TestCase, XrayRunContext } from "./types";

/** Vista Markdown de los Test Cases importados para revisión humana y trazabilidad. */
export function renderTestCasesMarkdown(xray: XrayRunContext, testCases: TestCase[]): string {
    const header = [
        `# Test Cases importados de Xray - ${xray.selector}`,
        "",
        `**Lote:** ${xray.label}`,
        xray.url ? `**Referencia:** ${xray.url}` : "",
        "",
        "## Test Cases recibidos",
        "",
    ];

    const body = testCases.map((testCase) =>
        [
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
        ].join("\n")
    );

    return [...header, ...body].join("\n");
}

function bullets(items: string[]): string[] {
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["- -"];
}
