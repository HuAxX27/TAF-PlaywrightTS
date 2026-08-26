import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";
import type { TestKind } from "../types";
import { knowledgeForPrompt } from "./knowledge";

const CONVENTIONS_FILE = path.join(agentConfig.root, "agent/docs/CONVENTIONS.md");

const KIND_CONVENTIONS_FILE: Record<TestKind, string> = {
    ui: path.join(agentConfig.root, "agent/docs/CONVENTIONS-UI.md"),
    api: path.join(agentConfig.root, "agent/docs/CONVENTIONS-API.md"),
};

interface ContextFile {
    label: string;
    file: string;
    content: string;
}

/**
 * Arma el contexto que el agente necesita para escribir código que ENCAJE en este
 * repositorio en vez de codigo Playwright generico.
 *
 * `kind` decide que capas del framework se mandan: un test de API no necesita
 * ver los Page Objects, y mandarselos lo empuja a escribir codigo de UI.
 */
export function buildFrameworkContext(kind: TestKind = "ui"): string {
    const files: ContextFile[] = [];

    // 1. Convenciones del framework (reemplazan el spec de ejemplo)
    const conventions = `${loadConventions()}\n\n${loadKindConventions(kind)}`;

    // 2. Fixtures disponibles
    push(files, "FIXTURES DISPONIBLES", agentConfig.fixturesPath);

    if (kind === "ui") {
        pushDir(files, "PAGE OBJECTS", path.resolve(agentConfig.root, "src/pages"));
        pushDir(files, "COMPONENTES", path.resolve(agentConfig.root, "src/components"));
    } else {
        pushDir(files, "CLIENTE Y SERVICIOS API", path.resolve(agentConfig.root, "src/api"));
        pushDir(files, "CONFIGURACION", path.resolve(agentConfig.root, "src/config"));
    }

    // Datos de prueba: los necesitan los dos tipos de test.
    pushDir(files, "DATOS DE PRUEBA", path.resolve(agentConfig.root, "src/data"));

    const sections = files.map(
        (entry) => `### ${entry.label} - ${entry.file}\n\`\`\`typescript\n${entry.content}\n\`\`\``
    );

    let context = `${conventions}\n\n${sections.join("\n\n")}`;

    if (context.length > agentConfig.maxContextChars) {
        context = `${context.slice(0, agentConfig.maxContextChars)}\n/* ...contexto truncado... */`;
    }

    // Va despues del truncado: las lecciones tienen su propio presupuesto y son lo
    // ultimo que conviene recortar, porque son lo que evita repetir errores.
    const lessons = knowledgeForPrompt(kind);
    if (lessons) {
        context += `\n\n### ${lessons}`;
    }

    return context;
}

/** Convenciones especificas del tipo de test, para el prompt de codegen. */
function loadKindConventions(kind: TestKind): string {
    const file = KIND_CONVENTIONS_FILE[kind];
    if (fs.existsSync(file)) {
        return fs.readFileSync(file, "utf-8");
    }

    return kind === "api"
        ? `Tests de API: sin navegador ni Page Objects. Las llamadas HTTP viven en un service de
src/api/services/. El spec afirma explicitamente el status code y los campos del body.
Payloads desde factories de src/data/. Tag @api obligatorio.`
        : `Tests de UI: los locators viven en Page Objects (src/pages) o Components (src/components),
nunca en el spec. Locators por rol/texto, nunca CSS. Sin waitForTimeout. Tag @ui obligatorio.`;
}

/**
 * Carga las convenciones desde el archivo CONVENTIONS.md
 */
function loadConventions(): string {
    if (fs.existsSync(CONVENTIONS_FILE)) {
        return fs.readFileSync(CONVENTIONS_FILE, "utf-8");
    }

    // Fallback a convenciones básicas si el archivo no existe
    return `CONVENCIONES DEL FRAMEWORK
- Estructura: src/pages (Page Objects), src/components (componentes reutilizables),
  src/api (cliente y servicios), src/data (factories con faker), src/fixtures (fixtures de Playwright),
  src/config (env y rutas), tests (specs).
- Los specs NUNCA declaran locators: viven en el Page Object o en el componente correspondiente.
- Los specs importan { test, expect } desde el fixture del framework, no desde @playwright/test.
- Cada paso logico va dentro de test.step con descripcion en espanol.
- Los tags se declaran con la firma test("titulo", { tag: ["@smoke"] }, async ({ ... }) => {}).
- Se usa baseURL del config; los page objects navegan con rutas relativas.
- Aserciones con expect de Playwright y auto-waiting. Prohibido waitForTimeout.`;
}

function push(files: ContextFile[], label: string, filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    files.push({
        label,
        file: path.relative(agentConfig.root, filePath).replace(/\\/g, "/"),
        content: fs.readFileSync(filePath, "utf-8").trim(),
    });
}

function pushDir(files: ContextFile[], label: string, dir: string): void {
    if (!fs.existsSync(dir)) return;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            pushDir(files, label, fullPath);
        } else if (entry.name.endsWith(".ts")) {
            push(files, label, fullPath);
        }
    }
}
