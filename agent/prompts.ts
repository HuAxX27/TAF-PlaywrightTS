import type {
    AutomationPlan,
    AnsweredQuestion,
    ExistingTest,
    KnowledgeBase,
    SessionLog,
    TestCase,
    TestKind,
    XrayRunContext,
} from "./types";

/**
 * Marcadores de tarea. Van en texto plano dentro del prompt para que cualquier
 * proveedor sepa con precision que tipo de respuesta debe producir.
 */
export const TASK = {
    clarify: "detectar-dudas",
    refine: "refinar-test-cases",
    classify: "clasificar-tipo-test",
    coverage: "analizar-cobertura",
    codegen: "generar-codigo",
    repair: "reparar-codigo",
    finalValidation: "validar-cobertura-final",
    distill: "destilar-aprendizaje",
} as const;

export type TaskMarker = (typeof TASK)[keyof typeof TASK];

export const SYSTEM_PROMPT = `Eres un Lead QA Automation Engineer con experiencia en Playwright + TypeScript.
Reglas innegociables:
- Respondes SOLO con lo que se te pide (JSON o codigo), sin introducciones ni explicaciones.
- No inventas funcionalidad que el Test Case de Xray no describe.
- Si un dato no esta en el Test Case, lo marcas como precondicion, no lo adivinas.`;

function json(value: unknown): string {
    return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

/** Paso 1b: que dudas o supuestos quedan abiertos y hay que preguntarle al humano. */
export function clarifyPrompt(xray: XrayRunContext, testCases: TestCase[]): string {
    return `TAREA: ${TASK.clarify}

Estos son Test Cases importados desde Xray.

CONTEXTO DE LA CORRIDA:
${json(xray)}

TEST CASES:
${json(testCases)}

Identifica UNICAMENTE lo que tuviste que asumir o lo que quedo ambiguo y que, si se resuelve mal,
haria que el test automatizado pruebe algo distinto a lo que el negocio espera. Ejemplos de dudas
legitimas: datos de prueba concretos que no estan en el Test Case (usuario, tarjeta, sucursal),
ambientes o URLs, mensajes de error exactos, cual es el comportamiento correcto cuando el Test Case
no lo dice, si un escenario se valida por UI o por API, precondiciones que alguien debe preparar.

Reglas:
- NO preguntes cosas que el Test Case ya responde.
- NO preguntes por detalles de implementacion del framework (locators, nombres de archivos).
- Maximo 6 preguntas, ordenadas de la que mas bloquea a la que menos.
- Si no hay ninguna duda real, responde con un array vacio [].
- "assumptionIfUnanswered" es lo que asumirias si nadie contesta: debe ser una decision concreta
  y accionable, no "se necesita mas informacion".

Responde UNICAMENTE con un array JSON:
[
  {
    "id": "Q-01",
    "question": "string, una sola pregunta clara y respondible",
    "why": "string, que se rompe o queda ambiguo si no se responde",
    "assumptionIfUnanswered": "string, la decision concreta que tomarias",
    "relatedTestCaseIds": ["TC-01"]
  }
]`;
}

/** Paso 1c: reescribir los test cases con las respuestas del humano aplicadas. */
export function refinePrompt(
    xray: XrayRunContext,
    testCases: TestCase[],
    answers: AnsweredQuestion[],
    feedback: string | undefined
): string {
    const answersBlock = answers
        .map(
            (item) =>
                `- PREGUNTA: ${item.question}\n  RESPUESTA${item.answeredByHuman ? " (del QA)" : " (supuesto aceptado)"}: ${item.answer}\n  AFECTA A: ${item.relatedTestCaseIds.join(", ") || "todos"}`
        )
        .join("\n");

    return `TAREA: ${TASK.refine}

Actualiza los test cases incorporando la informacion que dio el QA. Esta informacion es la
fuente de verdad: gana sobre cualquier supuesto anterior tuyo.

CONTEXTO DE LA CORRIDA:
${json(xray)}

TEST CASES ACTUALES:
${json(testCases)}

${answersBlock ? `RESPUESTAS DEL QA:\n${answersBlock}\n` : ""}${feedback ? `\nCAMBIOS QUE PIDIO EL QA EXPLICITAMENTE:\n${feedback}\n` : ""}
Reglas:
- Conserva los ids de los test cases que sigan siendo validos; no los renumeres sin necesidad.
- Aplica los datos concretos que dio el QA dentro de "preconditions", "steps" y "expectedResult".
- Si una respuesta revela un escenario que falta, agrega el test case correspondiente con id nuevo.
- Si una respuesta descarta un escenario, quitalo.
- No dejes texto tipo "TBD", "pendiente" o "<por definir>" en ningun campo.
- Manten el campo "kind" ("ui" | "api") coherente con la respuesta del QA.

Responde UNICAMENTE con el array JSON completo de test cases, con la misma forma que antes.`;
}

/** Paso 1d: clasificar los test cases ambiguos entre UI y API. */
export function classifyPrompt(testCases: TestCase[]): string {
    return `TAREA: ${TASK.classify}

Clasifica cada test case segun COMO se debe automatizar.

${json(testCases)}

- "api": el comportamiento se verifica llamando directamente a un servicio (REST/GraphQL) y
  revisando status code, body, headers o contrato. No se necesita navegador.
- "ui": el comportamiento solo se puede verificar interactuando con la interfaz en un navegador
  (clicks, formularios, elementos visibles, navegacion).

Si el escenario podria hacerse por los dos caminos, elige el que verifica el RIESGO real que
describe el test case: si lo que importa es lo que ve el usuario, es "ui"; si lo que importa es
la respuesta del servicio, es "api".

Responde UNICAMENTE con un array JSON:
[
  { "testCaseId": "TC-01", "kind": "ui", "confidence": 85, "rationale": "string" }
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
    /** Convenciones especificas del tipo de test (UI o API). */
    kind: TestKind;
    kindConventions: string;
    /** Snapshot real de accesibilidad de la pagina bajo prueba, o vacio si no se pudo explorar. */
    pageExploration?: string;
    explorationWarning?: string;
    /** Respuestas del QA a las dudas del agente: son fuente de verdad. */
    humanAnswers?: AnsweredQuestion[];
    /** Cambios que el QA pidio sobre el codigo generado en una ronda previa. */
    humanFeedback?: string;
    /** Hechos del dominio confirmados en sesiones anteriores (agent/knowledge/). */
    domainFacts?: string;
    /** Plan producido antes de codegen; evita que el modelo rediseñe el caso al escribir. */
    automationPlan?: AutomationPlan;
}

/** El plan separa razonamiento de implementacion y deja una pieza auditable. */
export function automationPlanPrompt(testCase: TestCase, kind: TestKind): string {
    return `TAREA: plan-automatizacion

Convierte este Test Case YA definido en Xray en un plan de automatizacion. No escribas codigo,
no inventes pasos de negocio y no declares locators. Debes conservar cada accion y resultado
esperado del test case como evidencia o assertion verificable.

TEST CASE:
${json(testCase)}

TIPO: ${kind.toUpperCase()}

Responde SOLO JSON valido:
{
  "testCaseId": "${testCase.id}",
  "kind": "${kind}",
  "module": "dominio-funcional",
  "startPath": "/ruta-inicial o /",
  "requiredEvidence": ["elemento o estado que debe observarse antes de generar"],
  "assertions": ["assertion observable por cada expected result"],
  "filesToModify": ["src/pages/DomainPage.ts", "spec"],
  "risks": ["precondicion o dato que necesita confirmacion"]
}`;
}

const FILE_FORMAT_RULES = `Responde con uno o mas bloques con este formato EXACTO, uno por archivo:

FILE: <ruta relativa desde la raiz del repo>
\`\`\`typescript
<contenido completo del archivo>
\`\`\`

- El primer bloque SIEMPRE es el spec, con ruta exacta "NOMBRE_ARCHIVO" (ver mas abajo).
- Solo puedes crear o modificar archivos dentro de: src/pages/, src/components/, src/api/, src/data/, src/fixtures/.
- No reescribas un archivo existente completo si solo necesitas agregarle un metodo o locator:
  copia el archivo completo con tu cambio aplicado (el bundle reemplaza el archivo entero).
- No incluyas explicaciones fuera de los bloques FILE.`;

const UI_CODEGEN_RULES = `REGLAS PARA UN TEST DE UI:
- Importa test y expect desde "RUTA_IMPORT_FIXTURES" en el spec, nunca desde "@playwright/test".
- El spec NO declara locators: viven en el Page Object (src/pages/) o Component (src/components/).
- Si el snapshot de accesibilidad esta disponible, TODOS los locators deben poder resolverse con
  esos roles/textos reales. No inventes selectores que contradigan la evidencia disponible.
- Si necesitas un Page Object o Component que no existe, CREALO completo (constructor, locators,
  metodos de accion) siguiendo el patron de los que ya existen en el framework.
- Si necesitas agregar un metodo/locator a un Page Object o Component YA existente, reescribe ese
  archivo completo con el cambio aplicado.
- Si el fixture de test.ts necesita registrar un Page Object nuevo, reescribelo completo con el
  fixture agregado.
- Locators por rol/nombre accesible (getByRole), luego getByText, ultimo recurso getByTestId.
  Prohibidos los selectores CSS de clases.
- Nada de waitForTimeout: usa aserciones con auto-waiting o waitForURL / waitForLoadState.
- No asumas overlays, banners, carga diferida ni rutas propias de ejecuciones anteriores. Solo
  implementa un manejo especial cuando el Test Case, la exploracion o un fallo reproducido lo prueben.`;

const API_CODEGEN_RULES = `REGLAS PARA UN TEST DE API:
- Importa test y expect desde "RUTA_IMPORT_FIXTURES" en el spec, nunca desde "@playwright/test".
- PROHIBIDO usar el fixture "page", abrir navegador, o usar Page Objects / locators / getByRole.
  Un test de API que abre navegador esta mal escrito.
- Las llamadas HTTP van en un Service de src/api/services/ (una clase por recurso), NO en el spec.
  El spec solo prepara datos, invoca el service y hace aserciones.
- Si el Service que necesitas no existe, CREALO en src/api/services/<recurso>Service.ts siguiendo
  el patron de los que ya existen, y registralo como fixture en src/fixtures/test.ts.
- Declara interfaces TypeScript para request y response; nada de "any".
- El spec debe afirmar EXPLICITAMENTE el status code esperado y los campos relevantes del body.
  Para verificar el status necesitas la respuesta cruda: usa el APIRequestContext / metodo del
  service que la exponga en vez de asumir 2xx.
- Para casos negativos (400, 401, 404, 422) NO uses un metodo que lance excepcion al no ser 2xx:
  obten la respuesta y verifica status y mensaje de error.
- Limpia lo que crees (delete del recurso) en un test.afterEach o en el propio test si el escenario
  crea datos.
- Datos de prueba desde un factory de src/data/ con faker; nunca credenciales hardcodeadas.
- No uses timeouts arbitrarios ni sleeps.`;

/** Paso 3: Test Case faltante -> spec de Playwright + Page Objects/Services/fixtures que falten. */
export function codegenPrompt(testCase: TestCase, context: CodegenContext): string {
    const isApi = context.kind === "api";

    return `TAREA: ${TASK.codegen}

TIPO_DE_TEST: ${context.kind.toUpperCase()}

Escribe el spec de Playwright para este test case de ${isApi ? "API" : "UI"}, y CUALQUIER
${isApi ? "service, tipo o factory" : "Page Object, componente, locator o fixture"} que le falte al
framework para que el spec funcione de punta a punta sin dejar ningun TODO. El humano solo debe
correr el test y revisar el resultado.

${json(testCase)}

RUTA_IMPORT_FIXTURES: ${context.importPath}
NOMBRE_ARCHIVO: ${context.specRelPath}

CONVENCIONES OBLIGATORIAS PARA TESTS DE ${context.kind.toUpperCase()}:

${context.kindConventions}

Asi esta construido el framework. Reutiliza lo que ya existe; no dupliques ${isApi ? "services ni tipos" : "page objects ni locators"}:

${context.frameworkContext}
${context.automationPlan ? `\nPLAN DE AUTOMATIZACION APROBADO PARA ESTE TC (implementalo; no lo rediseñes):\n${json(context.automationPlan)}\n` : ""}
${renderHumanInputBlock(context)}${
        !isApi && context.pageExploration
            ? `\nSNAPSHOT DE ACCESIBILIDAD REAL DE LA PAGINA (usa estos textos/roles exactos para los locators, NO inventes otros):\n\`\`\`\n${context.pageExploration}\n\`\`\`\n`
            : ""
    }${
        !isApi && context.explorationWarning
            ? `\nADVERTENCIA: no se pudo explorar la pagina en vivo (${context.explorationWarning}). Escribe los locators con el rol/texto mas probable segun el test case, y deja un comentario // TODO: verificar locator contra el sitio real.\n`
            : ""
    }
${(isApi ? API_CODEGEN_RULES : UI_CODEGEN_RULES).replace(/RUTA_IMPORT_FIXTURES/g, context.importPath)}

Reglas comunes:
- Envuelve cada paso logico del spec en test.step con una descripcion en espanol.
- Declara los tags con la firma test("titulo", { tag: [...] }, async ({ ... }) => {}).
- El spec debe cubrir TODOS los pasos y el resultado esperado del test case: una asercion por
  cada cosa que el test case afirma. No omitas ninguna.
- Todo el codigo debe compilar con TypeScript en modo strict.

${FILE_FORMAT_RULES}`;
}

/** Bloque con las respuestas del QA, para que el codigo no vuelva a inventar lo ya resuelto. */
function renderHumanInputBlock(context: CodegenContext): string {
    const answered = (context.humanAnswers ?? []).filter((item) => item.answeredByHuman);
    const parts: string[] = [];

    if (answered.length > 0) {
        parts.push(
            `\nDECISIONES QUE YA TOMO EL QA (son fuente de verdad, respetalas al escribir el codigo):\n${answered
                .map((item) => `- ${item.question} -> ${item.answer}`)
                .join("\n")}\n`
        );
    }

    if (context.humanFeedback?.trim()) {
        parts.push(
            `\nCAMBIOS QUE PIDIO EL QA SOBRE EL CODIGO GENERADO ANTES (aplicalos sin cambiar la intencion del test case):\n${context.humanFeedback.trim()}\n`
        );
    }

    if (context.domainFacts?.trim()) {
        parts.push(`\n${context.domainFacts.trim()}\n`);
    }

    return parts.join("");
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
Este es un test de ${context.kind.toUpperCase()}: ${
        context.kind === "api"
            ? "no introduzcas navegador, page ni Page Objects."
            : "manten el patron de Page Objects; el spec no declara locators."
    }

${FILE_FORMAT_RULES}

Responde con TODOS los archivos corregidos y completos (spec + soporte), en el mismo formato.`;
}

/** Paso 5: cierre del ciclo - el TC original vs el codigo que realmente se escribio. */
export function finalValidationPrompt(
    testCase: TestCase,
    specContent: string,
    supportFiles: Array<{ path: string; content: string }>
): string {
    const supportBlock = supportFiles
        .map((file) => `FILE: ${file.path}\n\`\`\`typescript\n${file.content}\n\`\`\``)
        .join("\n\n");

    return `TAREA: ${TASK.finalValidation}

Eres el revisor. Compara el TEST CASE ORIGINAL contra el CODIGO que se genero y determina si el
codigo verifica REALMENTE todo lo que el test case pide.

TEST CASE ORIGINAL (fuente de verdad):
${json(testCase)}

CODIGO GENERADO (spec):
\`\`\`typescript
${specContent}
\`\`\`
${supportBlock ? `\nARCHIVOS DE SOPORTE:\n${supportBlock}\n` : ""}
Como evaluar:
- Descompon el test case en escenarios verificables: cada paso relevante, cada precondicion que el
  codigo deba establecer, y CADA afirmacion del resultado esperado por separado.
- Para cada escenario, busca en el codigo la accion Y la asercion que lo prueban.
- "covered": el codigo ejecuta el escenario y lo AFIRMA con un expect. Sin expect no esta cubierto.
- "partial": el codigo ejecuta la accion pero no verifica el resultado, o la asercion es mas debil
  de lo que el test case pide (ej. el TC exige un texto exacto y el codigo solo valida visibilidad).
- "missing": el codigo no hace nada al respecto.
- Un test.step con nombre correcto pero cuerpo vacio, comentado, con TODO o con test.fixme NO cubre nada.
- En "evidence" cita el fragmento real del codigo (nombre del test.step o la linea del expect).
- En "extraBehaviors" lista lo que el codigo valida y el test case NO pedia.
- Se estricto: es peor aprobar un test que no prueba lo que dice, que pedir una correccion de mas.

Responde UNICAMENTE con un objeto JSON:
{
  "testCaseId": "${testCase.id}",
  "scenarios": [
    {
      "scenario": "string, el escenario tomado del test case",
      "status": "covered",
      "evidence": "string, fragmento real del codigo que lo prueba",
      "gap": "string, que falta (vacio si esta cubierto)"
    }
  ],
  "missingScenarios": ["string"],
  "extraBehaviors": ["string"],
  "verdict": "string, una o dos frases con la conclusion"
}`;
}

/**
 * Paso 6: destilar la sesion en conocimiento reutilizable.
 *
 * Se le manda lo que YA sabe la base para que no vuelva a proponerlo: el valor
 * esta en lo que es nuevo, no en reescribir las convenciones que ya estan escritas.
 */
export function distillPrompt(session: SessionLog, knowledge: KnowledgeBase): string {
    const existingRules = knowledge.rules
        .map((rule) => `- [${rule.scope}/${rule.category}] ${rule.rule}`)
        .join("\n");
    const existingFacts = knowledge.facts
        .map((fact) => `- (${fact.area}) ${fact.question} -> ${fact.answer}`)
        .join("\n");
    const existingRecipes = knowledge.recipes
        .map((recipe) => `- [${recipe.scope}] ${recipe.problem}`)
        .join("\n");

    return `TAREA: ${TASK.distill}

Eres el responsable de la memoria a largo plazo de un agente que genera tests de Playwright.
Tu trabajo es convertir lo que paso en ESTA sesion en conocimiento que haga que la PROXIMA
sesion necesite menos intentos, menos preguntas y menos tokens.

LO QUE PASO EN ESTA SESION:
${json(session)}

LO QUE LA BASE DE CONOCIMIENTO YA SABE (NO lo repitas, NO lo reformules):
${existingRules ? `REGLAS:\n${existingRules}` : "REGLAS: (ninguna todavia)"}

${existingRecipes ? `RECETAS:\n${existingRecipes}` : "RECETAS: (ninguna todavia)"}

${existingFacts ? `HECHOS:\n${existingFacts}` : "HECHOS: (ninguno todavia)"}

QUE EXTRAER

1. "rules" - lecciones normativas. Solo de:
   - un error real que hubo que reparar (mira "repairs": compara codeBefore con codeAfter y
     deduce la regla que habria evitado ese error desde el principio) -> "origin": "repair";
   - una correccion o comentario del humano (mira "humanInput" tipo feedback) -> "origin": "human";
   - un escenario que el codigo no cubrio (mira "coverageGaps") -> "origin": "coverage-gap".
   Escribelas en imperativo y autocontenidas: quien las lea sin ver esta sesion debe poder
   aplicarlas. Incluye el "trigger": el sintoma que permite reconocer cuando aplican.
   "scope" es "api" si solo aplica a tests de servicio, "ui" si solo a tests de navegador,
   "both" si aplica a los dos.

2. "recipes" - soluciones de codigo que YA funcionaron (el codeAfter de una reparacion exitosa).
   Solo si el problema es recurrente y la solucion es reutilizable tal cual. El "code" debe ser
   un fragmento completo y compilable, no un esbozo. Maximo 2 por sesion.

3. "facts" - datos del dominio o del ambiente que el agente NO puede deducir del codigo y que
   un humano tuvo que aportar: URLs, rutas de PDFs, textos exactos, usuarios de prueba,
   nombres de sucursales, mensajes de error del negocio, decisiones de producto.
   Salen casi siempre de "humanInput" tipo answer. Guarda la pregunta que responden para
   poder reusarlos. NUNCA guardes contrasenas, tokens ni secretos: si la respuesta del humano
   contiene uno, omite ese hecho por completo.

4. "violatedRules" - ids de reglas que ya estaban en la base y que el codigo de esta sesion
   incumplio (se ve porque hubo que repararlo por ese motivo). Sirve para detectar reglas
   que estan mal redactadas y no se estan respetando.

REGLAS DE ORO

- Calidad sobre cantidad: 2 reglas accionables valen mas que 10 genericas. Array vacio es una
  respuesta valida y correcta si la sesion no ensena nada nuevo.
- PROHIBIDO extraer lo que ya esta en las convenciones del framework ("usa test.step",
  "usa getByRole", "importa desde el fixture", "no uses waitForTimeout"). Eso ya se le dice
  al modelo en cada prompt; repetirlo solo gasta tokens.
- PROHIBIDO describir sintomas sin decir que hacer. Mal: "fallo el locator".
  Bien: "El snapshot confirma que el control tiene rol button y nombre Guardar: usa ese contrato
  accesible en el Page Object en lugar del selector de clase generado".
- Nada de metricas ni de "se generaron N tests": eso se calcula solo.
- Si un hecho o regla contradice algo que ya esta en la base, no lo dupliques: reportalo en
  "notes" para que un humano lo revise.

Responde UNICAMENTE con un objeto JSON:
{
  "rules": [
    {
      "scope": "ui",
      "category": "locator",
      "rule": "instruccion en imperativo, autocontenida",
      "trigger": "sintoma observable que indica que aplica",
      "origin": "repair"
    }
  ],
  "recipes": [
    {
      "scope": "ui",
      "problem": "el problema recurrente que resuelve",
      "code": "codigo completo y compilable",
      "placement": "src/pages"
    }
  ],
  "facts": [
    {
      "question": "la pregunta que este dato responde",
      "answer": "el dato concreto",
      "area": "dominio-funcional"
    }
  ],
  "violatedRules": ["R-003"],
  "notes": "una o dos frases; vacio si no hay nada que reportar"
}`;
}
