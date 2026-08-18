import { CompletionRequest, LlmProvider } from "./provider";
import { TASK, type TaskMarker } from "../prompts";
import type { ExistingTest, TestCase, UserStory } from "../types";

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
            case TASK.coverage:
                return JSON.stringify(this.buildCoverage(request.prompt), null, 2);
            case TASK.codegen:
            case TASK.repair:
                return this.buildSpec(request.prompt);
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
            priority: index === 0 ? "critical" : "high",
            tags: ["@regression"],
            preconditions: ["El usuario esta en la pagina principal"],
            steps: ["Navegar a la pagina principal", `Verificar: ${criterion}`],
            expectedResult: criterion,
            automatable: true,
        }));

        cases.push({
            id: `TC-${String(cases.length + 1).padStart(2, "0")}`,
            title: "Comportamiento ante datos invalidos o estado inesperado",
            level: "e2e",
            priority: "medium",
            tags: ["@regression", "@negative"],
            preconditions: ["El usuario esta en la pagina principal"],
            steps: ["Forzar el escenario negativo descrito en la historia"],
            expectedResult: "La aplicacion muestra un mensaje de error controlado",
            automatable: true,
        });

        return cases;
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

    /** Esqueleto valido: compila, se lista en Playwright y respeta el POM. */
    private buildSpec(prompt: string): string {
        const testCase = jsonBlocks<TestCase>(prompt)[0];
        const importPath =
            prompt.match(/RUTA_IMPORT_FIXTURES:\s*(\S+)/)?.[1] ?? "../../src/fixtures/test";
        const title = testCase?.title ?? "Escenario generado";
        const tags = (testCase?.tags?.length ? testCase.tags : ["@regression"])
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

        return `import { test, expect } from "${importPath}";

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
