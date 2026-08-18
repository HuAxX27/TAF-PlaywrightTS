import type { ExistingTest, TestCase, UserStory } from "./types";

/**
 * Marcadores de tarea. Van en texto plano dentro del prompt para que cualquier
 * proveedor (incluido el mock determinista) sepa que se le esta pidiendo.
 */
export const TASK = {
    testCases: "generar-test-cases",
    coverage: "analizar-cobertura",
    codegen: "generar-codigo",
    repair: "reparar-codigo",
} as const;

export type TaskMarker = (typeof TASK)[keyof typeof TASK];

export const SYSTEM_PROMPT = `Eres un Lead QA Automation Engineer con experiencia en Playwright + TypeScript.
Reglas innegociables:
- Respondes SOLO con lo que se te pide (JSON o codigo), sin introducciones ni explicaciones.
- No inventas funcionalidad que la historia no describe.
- Si un dato no esta en la historia, lo marcas como precondicion, no lo adivinas.`;

function json(value: unknown): string {
    return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/** Paso 1: User Story -> Test Cases de negocio. */
export function testCasesPrompt(story: UserStory): string {
    return `TAREA: ${TASK.testCases}

Analiza esta User Story y disena la bateria de test cases que la cubre.

${json(story)}

Criterios de diseno:
- Un test case por comportamiento verificable. No agrupes varios criterios en uno.
- Cubre camino feliz, casos borde y casos negativos derivados de los criterios.
- "level": "e2e" si requiere navegador, "api" si se valida por servicio, "visual" o "a11y" si aplica.
- "priority": "critical" para el flujo principal de negocio, luego "high" | "medium" | "low".
- "tags": usa las etiquetas del framework: @smoke, @regression, @critical, @negative y una de dominio.
- "automatable": false SOLO si el escenario depende de algo que una prueba automatizada no puede observar;
  en ese caso explica el motivo en "notAutomatableReason".

Responde UNICAMENTE con un array JSON con esta forma exacta:
[
  {
    "id": "TC-01",
    "title": "string",
    "level": "e2e",
    "priority": "critical",
    "tags": ["@smoke"],
    "preconditions": ["string"],
    "steps": ["string"],
    "expectedResult": "string",
    "automatable": true,
    "notAutomatableReason": ""
  }
]`;
}

/** Paso 2: Test Cases vs pruebas ya existentes en el repositorio. */
export function coveragePrompt(testCases: TestCase[], inventory: ExistingTest[]): string {
    return `TAREA: ${TASK.coverage}

Estos son los test cases propuestos:

${json(testCases)}

Estas son TODAS las pruebas que ya existen en el framework (titulo real, archivo y tags):

${json(inventory)}

Determina, para cada test case, si ya esta cubierto por alguna prueba existente.
- "covered": una prueba existente ya valida exactamente ese comportamiento.
- "partial": una prueba existente lo toca pero deja sin verificar parte del resultado esperado.
- "missing": ninguna prueba existente lo cubre.

Comparas COMPORTAMIENTO, no parecido de texto: dos titulos distintos pueden ser el mismo caso,
y dos titulos parecidos pueden validar cosas diferentes. En "matchedTests" pon el archivo y el
titulo exactos de las pruebas que justifican tu decision.

Responde UNICAMENTE con un array JSON:
[
  { "testCaseId": "TC-01", "status": "missing", "matchedTests": [], "rationale": "string" }
]`;
}

export interface CodegenContext {
    frameworkContext: string;
    importPath: string;
    fileName: string;
}

/** Paso 3: Test Case faltante -> spec de Playwright. */
export function codegenPrompt(testCase: TestCase, context: CodegenContext): string {
    return `TAREA: ${TASK.codegen}

Escribe el spec de Playwright para este test case:

${json(testCase)}

RUTA_IMPORT_FIXTURES: ${context.importPath}
NOMBRE_ARCHIVO: ${context.fileName}

Asi esta construido el framework. Reutiliza lo que ya existe; no dupliques page objects ni locators:

${context.frameworkContext}

Reglas del codigo que devuelvas:
- Importa test y expect desde "${context.importPath}", nunca desde "@playwright/test".
- Usa los fixtures y page objects existentes. Si necesitas un locator que no existe, usa el
  metodo o rol mas cercano ya disponible y deja un comentario // TODO: agregar locator a <Componente>.
- Envuelve cada paso logico en test.step con una descripcion en espanol.
- Declara los tags con la firma test("titulo", { tag: [...] }, async ({ ... }) => {}).
- Nada de waitForTimeout, nada de selectores CSS fragiles, nada de datos hardcodeados que
  puedan venir de src/data.
- El archivo debe compilar con TypeScript en modo strict.

Responde UNICAMENTE con el codigo TypeScript del archivo .spec.ts.`;
}

/** Paso 4 (solo si la validacion fallo): reparar el codigo con el error real. */
export function repairPrompt(code: string, errors: string[], context: CodegenContext): string {
    return `TAREA: ${TASK.repair}

Este archivo generado no pasa la validacion del repositorio.

CODIGO ACTUAL:
\`\`\`typescript
${code}
\`\`\`

ERRORES REALES DE TypeScript / ESLint / Playwright:
${errors.map((error) => `- ${error}`).join("\n")}

Contexto del framework:

${context.frameworkContext}

Corrige EXCLUSIVAMENTE lo que causa esos errores. No cambies la intencion de la prueba ni
agregues escenarios nuevos. Importa desde "${context.importPath}".

Responde UNICAMENTE con el codigo TypeScript corregido y completo.`;
}
