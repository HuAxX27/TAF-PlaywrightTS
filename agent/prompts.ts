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
    specRelPath: string;
    /** Snapshot real de accesibilidad de la pagina bajo prueba, o vacio si no se pudo explorar. */
    pageExploration?: string;
    explorationWarning?: string;
}

const FILE_FORMAT_RULES = `Responde con uno o mas bloques con este formato EXACTO, uno por archivo:

FILE: <ruta relativa desde la raiz del repo>
\`\`\`typescript
<contenido completo del archivo>
\`\`\`

- El primer bloque SIEMPRE es el spec, con ruta exacta "NOMBRE_ARCHIVO" (ver mas abajo).
- Solo puedes crear o modificar archivos dentro de: src/pages/, src/components/, src/data/, src/fixtures/.
- No reescribas un archivo existente completo si solo necesitas agregarle un metodo o locator:
  copia el archivo completo con tu cambio aplicado (el bundle reemplaza el archivo entero).
- No incluyas explicaciones fuera de los bloques FILE.`;

/** Paso 3: Test Case faltante -> spec de Playwright + Page Objects/Components/fixtures que falten. */
export function codegenPrompt(testCase: TestCase, context: CodegenContext): string {
    return `TAREA: ${TASK.codegen}

Escribe el spec de Playwright para este test case, y CUALQUIER Page Object, componente,
locator o fixture que le falte al framework para que el spec funcione de punta a punta
sin dejar ningun TODO. El humano solo debe correr el test y revisar el resultado.

${json(testCase)}

RUTA_IMPORT_FIXTURES: ${context.importPath}
NOMBRE_ARCHIVO: ${context.specRelPath}

Asi esta construido el framework. Reutiliza lo que ya existe; no dupliques page objects ni locators:

${context.frameworkContext}
${
    context.pageExploration
        ? `\nSNAPSHOT DE ACCESIBILIDAD REAL DE LA PAGINA (usa estos textos/roles exactos para los locators, NO inventes otros):\n\`\`\`\n${context.pageExploration}\n\`\`\`\n`
        : ""
}${
    context.explorationWarning
        ? `\nADVERTENCIA: no se pudo explorar la pagina en vivo (${context.explorationWarning}). Escribe los locators con el rol/texto mas probable segun el test case, y deja un comentario // TODO: verificar locator contra el sitio real.\n`
        : ""
}
Reglas del codigo que devuelvas:
- Importa test y expect desde "${context.importPath}" en el spec, nunca desde "@playwright/test".
- Si el snapshot de accesibilidad esta disponible, TODOS los locators deben poder resolverse con
  esos roles/textos reales. Si no esta disponible, es la UNICA situacion en la que puedes dejar un
  TODO explicando que locator falta verificar.
- Si necesitas un Page Object o Component que no existe, CREALO completo (constructor, locators,
  metodos de accion) siguiendo el patron de los que ya existen en el framework.
- Si necesitas agregar un metodo/locator a un Page Object o Component YA existente, reescribe ese
  archivo completo con el cambio aplicado.
- Si el TC necesita datos de prueba (usuarios, textos), usa o crea un factory en src/data/ con faker;
  nunca hardcodees credenciales o datos sensibles directo en el spec.
- Si el fixture de test.ts necesita registrar un Page Object nuevo, reescribelo completo con el
  fixture agregado.
- Envuelve cada paso logico del spec en test.step con una descripcion en espanol.
- Declara los tags con la firma test("titulo", { tag: [...] }, async ({ ... }) => {}).
- Nada de waitForTimeout, nada de selectores CSS fragiles.
- Todo el codigo debe compilar con TypeScript en modo strict.

${FILE_FORMAT_RULES}`;
}

/** Paso 4 (solo si la validacion fallo): reparar el bundle completo con el error real. */
export function repairPrompt(
    files: Array<{ path: string; content: string }>,
    errors: string[],
    context: CodegenContext
): string {
    const filesBlock = files
        .map((file) => `FILE: ${file.path}\n\`\`\`typescript\n${file.content}\n\`\`\``)
        .join("\n\n");

    return `TAREA: ${TASK.repair}

Este bundle de archivos generado no pasa la validacion del repositorio.

ARCHIVOS ACTUALES:
${filesBlock}

ERRORES REALES DE TypeScript / ESLint / Playwright:
${errors.map((error) => `- ${error}`).join("\n")}

Contexto del framework:

${context.frameworkContext}

Corrige EXCLUSIVAMENTE lo que causa esos errores. No cambies la intencion de la prueba ni
agregues escenarios nuevos. El spec importa desde "${context.importPath}".

${FILE_FORMAT_RULES}

Responde con TODOS los archivos corregidos y completos (spec + soporte), en el mismo formato.`;
}
