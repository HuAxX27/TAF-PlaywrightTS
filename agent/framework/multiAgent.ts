import * as fs from "fs";
import * as path from "path";
import type { LlmProvider } from "../llm";
import type { TestError } from "./e2eValidation";
import type { CodegenContext } from "../prompts";

/**
 * Sistema multiagente para analizar y reparar tests fallidos.
 *
 * Arquitectura:
 * - Agente Analizador: diagnostica el tipo de error y su causa raíz
 * - Agente Reparador: propone correcciones específicas al código
 * - Agente Validador: verifica que la corrección sea coherente
 */

export interface AnalysisResult {
    rootCause: string;
    errorCategory: "locator" | "timing" | "assertion" | "data" | "navigation" | "other";
    affectedComponents: string[];
    suggestedFixes: string[];
    confidence: number;
}

export interface RepairProposal {
    filePath: string;
    originalCode: string;
    repairedCode: string;
    explanation: string;
    confidence: number;
}

export interface MultiAgentResult {
    analysis: AnalysisResult;
    proposals: RepairProposal[];
    validation: RepairValidation;
}

export interface RepairValidation {
    verdict: "approve" | "approve_with_reservations" | "reject";
    notes: string;
}

/** Archivos editables durante la reparacion, con su ruta relativa exacta al repo. */
export interface RepairTarget {
    relPath: string;
    content: string;
}

/** Diagnostico generico: cada hipotesis debe sostenerse con evidencia de la corrida actual. */
const UI_FAILURE_PLAYBOOK = `REGLAS DE DIAGNOSTICO PARA TESTS DE UI:

1. USA EVIDENCIA DE LA CORRIDA ACTUAL
   Contrasta el error, stack, screenshot, URL y snapshot de accesibilidad. No heredes supuestos
   sobre modales, banners, carga diferida o estructura de pagina de otros tests.

2. LOCALIZADORES
   Si el elemento aparece en el snapshot, compara rol, nombre accesible y estado real. Ajusta el
   locator solo cuando la evidencia demuestre que no representa la UI. No uses CSS fragil.

3. NAVEGACION Y ESTADO
   Verifica primero la URL, redirecciones, autenticacion y precondiciones. Un elemento ausente puede
   indicar que el test esta en la pagina o estado equivocado.

4. ELEMENTOS QUE BLOQUEAN INTERACCIONES
   Agrega manejo de overlays o banners unicamente si el screenshot o snapshot confirma que existen.
   Implementalo como comportamiento reutilizable e idempotente fuera del spec.

5. SINCRONIZACION
   Usa auto-waiting y aserciones sobre estados observables. Prohibido waitForTimeout y aumentar
   timeouts para ocultar una causa desconocida.`;

/** Los fallos de un test de API son de otra naturaleza: nada de overlays ni locators. */
const API_FAILURE_PLAYBOOK = `PATRONES DE FALLO CONOCIDOS EN TESTS DE API:

1. STATUS CODE INESPERADO
   Sintoma: expect(response.status()).toBe(201) recibe 400/401/404/500.
   Causa: payload incompleto o invalido, falta autenticacion, o la ruta esta mal.
   Fix: revisar el payload contra el contrato y los headers de autorizacion. NUNCA "arregles"
   esto relajando la asercion del status a un rango generico.

2. EL METODO TIPADO LANZA ANTES DE PODER AFIRMAR EL STATUS
   Sintoma: el test falla con "failed with status 4xx" en vez de la asercion esperada.
   Causa: se uso un metodo que valida 2xx internamente para un caso negativo.
   Fix: usar el metodo *Raw del ApiClient/service, que devuelve la respuesta sin validar.

3. RESPUESTA NO ES JSON
   Sintoma: error al hacer res.json() ("Unexpected token < in JSON").
   Causa: el endpoint devolvio HTML (404 del servidor, redireccion a login) o cuerpo vacio.
   Fix: afirmar primero el status y el content-type, y solo entonces parsear el body.

4. BASE URL O RUTA EQUIVOCADA
   Sintoma: 404 en todas las llamadas.
   Fix: revisar env.baseURL y que la ruta del service sea relativa y correcta.

5. DEPENDENCIA DE DATOS ENTRE TESTS
   Sintoma: el test pasa solo o falla en paralelo.
   Fix: cada test crea sus propios datos con el factory y los limpia; nunca reusar ids fijos.

PROHIBIDO EN UN TEST DE API: introducir el fixture "page", navegador, Page Objects o locators.`;

/**
 * Agente Analizador: diagnostica errores de tests E2E
 */
export async function analyzeTestFailure(
    provider: LlmProvider,
    specPath: string,
    errors: TestError[],
    testOutput: string,
    screenshots: string[],
    context: CodegenContext,
    supportFiles: RepairTarget[] = []
): Promise<AnalysisResult> {
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specRel = path.basename(specPath);

    const prompt = `TAREA: analizar-fallo-test

Eres un experto en debugging de tests E2E con Playwright. Analiza el siguiente test fallido y diagnostica la causa raíz.

ARCHIVO DEL TEST:
\`\`\`typescript
// ${specRel}
${specContent}
\`\`\`
${renderSupportBlock(supportFiles)}
ERRORES DETECTADOS:
${errors
    .map(
        (e, i) => `
Error ${i + 1} (tipo: ${e.type}):
${e.message}
${e.stack ? `\nStack:\n${e.stack}` : ""}
${e.location ? `\nUbicación: ${e.location.file}:${e.location.line}:${e.location.column}` : ""}
`
    )
    .join("\n---\n")}

SALIDA DEL TEST:
\`\`\`
${testOutput.slice(-4000)}
\`\`\`

${screenshots.length > 0 && context.kind !== "api" ? `SCREENSHOTS CAPTURADOS: ${screenshots.length} archivo(s)\n${screenshots.map((s) => `- ${path.basename(s)}`).join("\n")}` : ""}

TIPO DE TEST: ${context.kind.toUpperCase()}

${playbookFor(context.kind)}

CONTEXTO DEL FRAMEWORK:
${context.frameworkContext}
${
    context.kind !== "api" && context.pageExploration
        ? `\nSNAPSHOT DE ACCESIBILIDAD REAL DE LA PAGINA (fuente de verdad para los locators):\n\`\`\`\n${context.pageExploration}\n\`\`\`\n`
        : ""
}
INSTRUCCIONES:
1. Compara el fallo contra los PATRONES DE FALLO CONOCIDOS antes de cualquier otra hipótesis.
2. Identifica la causa raíz real (no el síntoma) y sustentala con evidencia de esta corrida.
3. Si el snapshot de accesibilidad confirma que el texto del locator existe, la categoría NO es "locator".
4. Clasifica el error y lista los componentes afectados con su ruta relativa real.
5. Propón 2-3 correcciones específicas y accionables.
6. Asigna un nivel de confianza (0-100).

Responde SOLO con un JSON válido:
{
  "rootCause": "descripción clara de la causa raíz",
  "errorCategory": "locator|timing|assertion|data|navigation|other",
  "affectedComponents": ["src/pages/DomainPage.ts"],
  "suggestedFixes": ["fix 1", "fix 2", "fix 3"],
  "confidence": 85
}`;

    const response = await provider.complete({
        system: "Eres un experto en debugging de tests E2E. Respondes solo con JSON válido.",
        prompt,
    });

    try {
        const json = extractJson(response);
        return {
            rootCause: (json.rootCause as string) ?? "Causa desconocida",
            errorCategory: (json.errorCategory as AnalysisResult["errorCategory"]) ?? "other",
            affectedComponents: (json.affectedComponents as string[]) ?? [],
            suggestedFixes: (json.suggestedFixes as string[]) ?? [],
            confidence: (json.confidence as number) ?? 50,
        };
    } catch (error) {
        console.warn("Error parseando análisis del agente:", error);
        return {
            rootCause: "No se pudo analizar el error",
            errorCategory: "other",
            affectedComponents: [],
            suggestedFixes: [],
            confidence: 0,
        };
    }
}

/**
 * Agente Reparador: genera código corregido basado en el análisis
 */
export async function proposeRepairs(
    provider: LlmProvider,
    specPath: string,
    analysis: AnalysisResult,
    errors: TestError[],
    context: CodegenContext,
    supportFiles: RepairTarget[] = []
): Promise<RepairProposal[]> {
    const specContent = fs.readFileSync(specPath, "utf-8");
    const specRel = context.specRelPath;
    const editablePaths = [specRel, ...supportFiles.map((file) => file.relPath)];

    const prompt = `TAREA: reparar-test-fallido

Eres un experto en Playwright. Basándote en el análisis del error, repara el test para que funcione correctamente.

ARCHIVO DEL TEST (ruta relativa exacta: ${specRel}):
\`\`\`typescript
${specContent}
\`\`\`
${renderSupportBlock(supportFiles)}
ANÁLISIS DEL ERROR:
- Causa raíz: ${analysis.rootCause}
- Categoría: ${analysis.errorCategory}
- Componentes afectados: ${analysis.affectedComponents.join(", ")}
- Correcciones sugeridas:
${analysis.suggestedFixes.map((fix, i) => `  ${i + 1}. ${fix}`).join("\n")}

ERRORES ORIGINALES:
${errors.map((e, i) => `${i + 1}. [${e.type}] ${e.message}`).join("\n")}

TIPO DE TEST: ${context.kind.toUpperCase()}

${playbookFor(context.kind)}

CONTEXTO DEL FRAMEWORK:
${context.frameworkContext}

RUTAS QUE PUEDES MODIFICAR (usa EXACTAMENTE estas cadenas en "filePath", sin inventar carpetas):
${editablePaths.map((p) => `- ${p}`).join("\n")}
También puedes crear archivos nuevos, pero solo dentro de ${context.kind === "api" ? "src/api/, src/data/ o src/fixtures/" : "src/pages/, src/components/, src/data/ o src/fixtures/"}.

INSTRUCCIONES:
1. Aplica el fix que ataca la causa raíz. ${
        context.kind === "api"
            ? "Si el problema es un status inesperado, corrige el payload/headers o usa el metodo *Raw; no relajes la asercion del status."
            : "Corrige un Page Object, Component o flujo solo cuando la evidencia de la corrida confirme la causa; no inventes comportamiento del sitio."
    }
2. Devuelve el contenido COMPLETO de cada archivo modificado (el archivo se sobrescribe entero).
3. El spec importa test y expect desde "${context.importPath}", nunca desde "@playwright/test".
4. Prohibido waitForTimeout${context.kind === "api" ? "" : ", selectores CSS frágiles"} y dejar TODO/PENDIENTE en el código.${
        context.kind === "api"
            ? "\n   Prohibido introducir el fixture page, navegador, Page Objects o locators."
            : ""
    }
5. Todo debe compilar con TypeScript strict.
6. No cambies la intención del test case ni agregues escenarios nuevos.

Responde con un JSON que contenga un array de propuestas:
{
  "proposals": [
    {
      "filePath": "${specRel}",
      "repairedCode": "código completo corregido",
      "explanation": "explicación de los cambios",
      "confidence": 90
    }
  ]
}`;

    const response = await provider.complete({
        system: "Eres un experto en Playwright. Respondes solo con JSON válido.",
        prompt,
    });

    try {
        const json = extractJson(response);
        const raw = (json.proposals as RepairProposal[]) ?? [];
        return raw
            .filter((proposal) => proposal?.filePath && proposal?.repairedCode)
            .map((proposal) => ({
                ...proposal,
                filePath: normalizeProposalPath(proposal.filePath, editablePaths),
            }));
    } catch (error) {
        console.warn("Error parseando propuestas del agente:", error);
        return [];
    }
}

/**
 * El LLM tiende a devolver rutas planas (tests/foo.spec.ts) aunque el spec viva en una
 * subcarpeta, lo que duplica archivos. Se reancla contra las rutas reales editables.
 */
function normalizeProposalPath(proposed: string, editablePaths: string[]): string {
    const clean = proposed.replace(/\\/g, "/").replace(/^\.\//, "");
    if (editablePaths.includes(clean)) return clean;

    const byBasename = editablePaths.find(
        (known) => path.posix.basename(known) === path.posix.basename(clean)
    );
    return byBasename ?? clean;
}

function renderSupportBlock(supportFiles: RepairTarget[]): string {
    if (supportFiles.length === 0) return "\n";

    const blocks = supportFiles
        .map((file) => `FILE: ${file.relPath}\n\`\`\`typescript\n${file.content}\n\`\`\``)
        .join("\n\n");

    return `\nARCHIVOS DE SOPORTE QUE USA EL TEST (rutas relativas exactas):\n${blocks}\n`;
}

/**
 * Agente Validador: verifica que las correcciones sean coherentes
 */
export async function validateRepairs(
    provider: LlmProvider,
    proposals: RepairProposal[],
    analysis: AnalysisResult,
    context: CodegenContext
): Promise<RepairValidation> {
    if (proposals.length === 0) {
        return { verdict: "reject", notes: "No hay propuestas para validar." };
    }

    const prompt = `TAREA: validar-reparaciones

Eres un revisor de código experto. Valida que las reparaciones propuestas sean correctas y coherentes.

ANÁLISIS ORIGINAL:
- Causa raíz: ${analysis.rootCause}
- Categoría: ${analysis.errorCategory}

PROPUESTAS DE REPARACIÓN:
${proposals
    .map(
        (p, i) => `
Propuesta ${i + 1} (confianza: ${p.confidence}%):
Archivo: ${p.filePath}
Cambios: ${p.explanation}

Código reparado (primeras 20 líneas):
\`\`\`typescript
${p.repairedCode.split("\n").slice(0, 20).join("\n")}
...
\`\`\`
`
    )
    .join("\n---\n")}

CONTEXTO DEL FRAMEWORK:
${context.frameworkContext}

INSTRUCCIONES:
1. Verifica que las correcciones aborden la causa raíz
2. Revisa que el código siga las convenciones del framework
3. Identifica posibles problemas o efectos secundarios
4. Da un veredicto: APROBAR, APROBAR_CON_RESERVAS, o RECHAZAR

Responde SOLO JSON valido:
{
  "verdict": "approve|approve_with_reservations|reject",
  "notes": "evaluacion breve y concreta"
}`;

    const response = await provider.complete({
        system: "Eres un revisor de código experto en Playwright.",
        prompt,
    });

    try {
        const parsed = extractJson(response);
        const verdict =
            parsed.verdict === "approve" ||
            parsed.verdict === "approve_with_reservations" ||
            parsed.verdict === "reject"
                ? parsed.verdict
                : "reject";
        return { verdict, notes: String(parsed.notes ?? "El revisor no aporto detalles.").trim() };
    } catch {
        return { verdict: "reject", notes: "El revisor no devolvio JSON valido." };
    }
}

/**
 * Orquestador del sistema multiagente
 */
export async function runMultiAgentRepair(
    provider: LlmProvider,
    specPath: string,
    errors: TestError[],
    testOutput: string,
    screenshots: string[],
    context: CodegenContext,
    supportFiles: RepairTarget[] = []
): Promise<MultiAgentResult> {
    console.log("       [Agente Analizador] diagnosticando errores...");
    const analysis = await analyzeTestFailure(
        provider,
        specPath,
        errors,
        testOutput,
        screenshots,
        context,
        supportFiles
    );

    console.log(`       causa raiz: ${truncate(analysis.rootCause, 160)}`);
    console.log(`       categoria: ${analysis.errorCategory} (confianza: ${analysis.confidence}%)`);

    console.log("       [Agente Reparador] generando correcciones...");
    const proposals = await proposeRepairs(
        provider,
        specPath,
        analysis,
        errors,
        context,
        supportFiles
    );

    console.log(`       ${proposals.length} propuesta(s) generada(s)`);

    const validation = await validateRepairs(provider, proposals, analysis, context);
    console.log(
        `       [Agente Validador] ${validation.verdict}: ${truncate(validation.notes, 160)}`
    );

    return {
        analysis,
        // Una reparacion rechazada nunca se aplica solo porque compila.
        proposals: validation.verdict === "reject" ? [] : proposals,
        validation,
    };
}

/** Los modos de fallo de un test de API no tienen nada que ver con los de UI. */
function playbookFor(kind: CodegenContext["kind"]): string {
    return kind === "api" ? API_FAILURE_PLAYBOOK : UI_FAILURE_PLAYBOOK;
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

function extractJson(text: string): Record<string, unknown> {
    // Intentar extraer JSON del texto
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    }
    throw new Error("No se encontró JSON válido en la respuesta");
}
