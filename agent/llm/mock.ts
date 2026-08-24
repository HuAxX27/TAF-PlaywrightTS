import { CompletionRequest, LlmProvider } from "./provider";
import { TASK, type TaskMarker } from "../prompts";
import type { ExistingTest, TestCase, TestKind, UserStory } from "../types";

/**
 * Proveedor determinista sin red ni API key.
 *
 * Existe para dos cosas: demostrar el pipeline completo en una presentacion sin
 * depender de ningun servicio, y poder probar el agente en CI. No razona: aplica
 * reglas fijas sobre los datos que el prompt ya trae.
 */
export class MockProvider implements LlmProvider {
    readonly name = "mock";
    readonly model = "deterministic-rules-v1";

    async complete(request: CompletionRequest): Promise<string> {
        const task = detectTask(request.prompt);

        switch (task) {
            case TASK.testCases:
                return JSON.stringify(this.buildTestCases(request.prompt), null, 2);
            case TASK.clarify:
                return JSON.stringify(this.buildQuestions(request.prompt), null, 2);
            case TASK.refine:
                // Sin razonamiento no hay refinamiento posible: devuelve los TCs tal cual.
                return JSON.stringify(jsonBlocks<TestCase[]>(request.prompt)[1] ?? [], null, 2);
            case TASK.classify:
                return JSON.stringify(this.buildKinds(request.prompt), null, 2);
            case TASK.coverage:
                return JSON.stringify(this.buildCoverage(request.prompt), null, 2);
            case TASK.codegen:
            case TASK.repair:
                return this.buildSpec(request.prompt);
            case TASK.finalValidation:
                return JSON.stringify(this.buildFinalValidation(request.prompt), null, 2);
            case TASK.distill:
                // Sin razonamiento no hay nada que destilar de forma confiable.
                return JSON.stringify(
                    { rules: [], recipes: [], facts: [], violatedRules: [], notes: "" },
                    null,
                    2
                );
            default:
                throw new Error(`MockProvider: tarea no reconocida en el prompt (${task})`);
        }
    }

    /** Un test case por criterio de aceptacion, mas un negativo. */
    private buildTestCases(prompt: string): TestCase[] {
        const story = jsonBlocks<UserStory>(prompt)[0];
        const criteria = story?.acceptanceCriteria?.length
            ? story.acceptanceCriteria
            : ["El sistema cumple el comportamiento descrito en la historia."];

        const cases: TestCase[] = criteria.map((criterion, index) => ({
            id: `TC-${String(index + 1).padStart(2, "0")}`,
            title: criterion.replace(/\.$/, ""),
            level: "e2e",
            kind: "ui",
            priority: index === 0 ? "critical" : "high",
            tags: ["@regression", "@ui"],
            preconditions: ["El usuario esta en la pagina principal"],
            steps: ["Navegar a la pagina principal", `Verificar: ${criterion}`],
            expectedResult: criterion,
            automatable: true,
        }));

        cases.push({
            id: `TC-${String(cases.length + 1).padStart(2, "0")}`,
            title: "Comportamiento ante datos invalidos o estado inesperado",
            level: "e2e",
            kind: "ui",
            priority: "medium",
            tags: ["@regression", "@negative", "@ui"],
            preconditions: ["El usuario esta en la pagina principal"],
            steps: ["Forzar el escenario negativo descrito en la historia"],
            expectedResult: "La aplicacion muestra un mensaje de error controlado",
            automatable: true,
        });

        return cases;
    }

    /** Una duda fija por cada TC sin precondiciones concretas: suficiente para demostrar el ciclo. */
    private buildQuestions(prompt: string): Array<Record<string, unknown>> {
        const testCases = jsonBlocks<TestCase[]>(prompt)[1] ?? [];
        const vague = testCases.filter(
            (testCase) => testCase.preconditions.length === 0 || !testCase.expectedResult
        );

        return vague.slice(0, 3).map((testCase, index) => ({
            id: `Q-${String(index + 1).padStart(2, "0")}`,
            question: `Que datos concretos se deben usar para "${testCase.title}"?`,
            why: "Sin datos concretos el test automatizado los inventaria.",
            assumptionIfUnanswered: "Se usaran datos generados con faker.",
            relatedTestCaseIds: [testCase.id],
        }));
    }

    /** Clasificacion lexica: verbos HTTP y vocabulario de servicios -> api. */
    private buildKinds(prompt: string): Array<Record<string, unknown>> {
        const testCases = jsonBlocks<TestCase[]>(prompt)[0] ?? [];

        return testCases.map((testCase) => {
            const text = [testCase.title, ...testCase.steps, testCase.expectedResult].join(" ");
            const kind: TestKind = /\b(api|endpoint|request|response|status\s?code|payload|rest|graphql)\b/i.test(
                text
            )
                ? "api"
                : "ui";

            return {
                testCaseId: testCase.id,
                kind,
                confidence: 60,
                rationale: "Regla lexica del proveedor mock.",
            };
        });
    }

    /** Un escenario por paso mas el resultado esperado; el mock no puede leer el codigo. */
    private buildFinalValidation(prompt: string): Record<string, unknown> {
        const testCase = jsonBlocks<TestCase>(prompt)[0];
        const scenarios = [...(testCase?.steps ?? []), testCase?.expectedResult ?? ""]
            .filter(Boolean)
            .map((scenario) => ({
                scenario,
                status: "partial",
                evidence: "El proveedor mock no analiza codigo.",
                gap: "Verificar manualmente con un proveedor de IA real.",
            }));

        return {
            testCaseId: testCase?.id ?? "TC",
            scenarios,
            missingScenarios: [],
            extraBehaviors: [],
            verdict:
                "El proveedor mock no puede juzgar cobertura real; usa un proveedor de IA para la validacion final.",
        };
    }

    /** Cobertura por solapamiento de palabras significativas con los titulos existentes. */
    private buildCoverage(prompt: string): Array<Record<string, unknown>> {
        const blocks = jsonBlocks<unknown>(prompt);
        const testCases = (blocks[0] ?? []) as TestCase[];
        const existing = (blocks[1] ?? []) as ExistingTest[];

        return testCases.map((testCase) => {
            const wanted = significantWords(testCase.title);
            const matches = existing.filter((candidate) => {
                const have = significantWords(candidate.title);
                const shared = wanted.filter((word) => have.includes(word));
                return shared.length >= 2;
            });

            return {
                testCaseId: testCase.id,
                status: matches.length > 0 ? "covered" : "missing",
                matchedTests: matches.map((match) => `${match.file} :: ${match.title}`),
                rationale:
                    matches.length > 0
                        ? "Coincidencia lexica con una prueba existente (regla del proveedor mock)."
                        : "Ningun titulo existente cubre este escenario.",
            };
        });
    }

    /** Esqueleto valido: compila, se lista en Playwright y respeta el POM. Formato FILE: (ver fileBundle.ts). */
    private buildSpec(prompt: string): string {
        const testCase = jsonBlocks<TestCase>(prompt)[0];
        const importPath =
            prompt.match(/RUTA_IMPORT_FIXTURES:\s*(\S+)/)?.[1] ?? "../../../src/fixtures/test";
        const specRelPath = prompt.match(/NOMBRE_ARCHIVO:\s*(\S+)/)?.[1] ?? "tests/ui/generated/tc.spec.ts";
        const kind = prompt.match(/TIPO_DE_TEST:\s*(\S+)/)?.[1]?.toLowerCase() === "api" ? "api" : "ui";
        const title = testCase?.title ?? "Escenario generado";
        const tags = (testCase?.tags?.length ? testCase.tags : [`@${kind}`, "@regression"])
            .map((tag) => `"${tag}"`)
            .join(", ");

        const steps = (testCase?.steps ?? ["Ejecutar el escenario"])
            .map(
                (
                    step,
                    index
                ) => `        await test.step("Paso ${index + 1}: ${escape(step)}", async () => {
            // TODO(mock): accion real del paso.
        });`
            )
            .join("\n\n");

        const spec =
            kind === "api"
                ? `import { test, expect } from "${importPath}";

test.describe("${escape(testCase?.id ?? "TC")} - ${escape(title)}", () => {
    test("${escape(title)}", { tag: [${tags}] }, async ({ apiClient }) => {
${steps}

        await test.step("Resultado esperado: ${escape(testCase?.expectedResult ?? title)}", async () => {
            // TODO(mock): el proveedor mock no conoce los endpoints reales del servicio.
            // Con un proveedor de IA real, aqui va la llamada al service y la asercion del status.
            expect(apiClient).toBeDefined();
        });
    });
});
`
                : `import { test, expect } from "${importPath}";

test.describe("${escape(testCase?.id ?? "TC")} - ${escape(title)}", () => {
    test.beforeEach(async ({ homePage }) => {
        await homePage.open();
    });

    test("${escape(title)}", { tag: [${tags}] }, async ({ homePage }) => {
${steps}

        await test.step("Resultado esperado: ${escape(testCase?.expectedResult ?? title)}", async () => {
            // TODO(mock): el proveedor mock no conoce los locators reales del sitio.
            // Con un proveedor de IA real, aqui va la asercion derivada del test case.
            await expect(homePage.footer.legalesHeading).toBeVisible();
        });
    });
});
`;

        return `FILE: ${specRelPath}\n\`\`\`typescript\n${spec}\`\`\`\n`;
    }
}

function detectTask(prompt: string): TaskMarker | "desconocida" {
    const found = prompt.match(/TAREA:\s*([\w-]+)/)?.[1];
    const known = Object.values(TASK) as string[];
    return known.includes(found ?? "") ? (found as TaskMarker) : "desconocida";
}

function jsonBlocks<T>(prompt: string): T[] {
    const blocks: T[] = [];
    const regex = /```json\s*([\s\S]*?)```/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(prompt)) !== null) {
        try {
            blocks.push(JSON.parse(match[1]) as T);
        } catch {
            // Un bloque ilegible no debe tumbar al proveedor mock.
        }
    }
    return blocks;
}

const STOP_WORDS = new Set([
    "debe",
    "el",
    "la",
    "los",
    "las",
    "un",
    "una",
    "de",
    "del",
    "en",
    "con",
    "que",
    "por",
    "para",
    "al",
    "y",
    "o",
    "se",
    "su",
    "sus",
    "es",
    "correcta",
    "correctos",
    "usuario",
    "sistema",
    "pagina",
]);

function significantWords(text: string): string[] {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
}

function escape(text: string): string {
    return text.replace(/"/g, "'").replace(/\r?\n/g, " ").trim();
}
