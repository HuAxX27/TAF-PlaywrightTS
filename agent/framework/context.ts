import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";

const CONVENTIONS = `CONVENCIONES DEL FRAMEWORK
- Estructura: src/pages (Page Objects), src/components (componentes reutilizables),
  src/api (cliente y servicios), src/data (factories con faker), src/fixtures (fixtures de Playwright),
  src/config (env y rutas), tests (specs).
- Los specs NUNCA declaran locators: viven en el Page Object o en el componente correspondiente.
- Los specs importan { test, expect } desde el fixture del framework, no desde @playwright/test.
- Cada paso logico va dentro de test.step con descripcion en espanol.
- Los tags se declaran con la firma test("titulo", { tag: ["@smoke"] }, async ({ ... }) => {}).
- Se usa baseURL del config; los page objects navegan con rutas relativas.
- Aserciones con expect de Playwright y auto-waiting. Prohibido waitForTimeout.`;

interface ContextFile {
    label: string;
    file: string;
    content: string;
}

/**
 * Arma el contexto que el LLM necesita para escribir codigo que ENCAJE en este
 * repositorio en vez de codigo Playwright generico.
 */
export function buildFrameworkContext(): string {
    const files: ContextFile[] = [];

    push(files, "FIXTURES DISPONIBLES", agentConfig.fixturesPath);
    pushDir(files, "PAGE OBJECTS", path.resolve(agentConfig.root, "src/pages"));
    pushDir(files, "COMPONENTES", path.resolve(agentConfig.root, "src/components"));
    pushDir(files, "CAPA API", path.resolve(agentConfig.root, "src/api"));
    pushDir(files, "DATOS DE PRUEBA", path.resolve(agentConfig.root, "src/data"));

    const example = findExampleSpec(agentConfig.testsDir);
    if (example) push(files, "EJEMPLO DE SPEC YA ESCRITO EN ESTE REPO (imitalo)", example);

    const sections = files.map(
        (entry) => `### ${entry.label} - ${entry.file}\n\`\`\`typescript\n${entry.content}\n\`\`\``
    );

    let context = `${CONVENTIONS}\n\n${sections.join("\n\n")}`;

    if (context.length > agentConfig.maxContextChars) {
        context = `${context.slice(0, agentConfig.maxContextChars)}\n/* ...contexto truncado... */`;
    }

    return context;
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

/** Prefiere un spec escrito a mano: el generado no es buen modelo a imitar. */
function findExampleSpec(dir: string): string | null {
    if (!fs.existsSync(dir)) return null;

    const candidates: string[] = [];

    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (path.resolve(fullPath) === agentConfig.generatedTestsDir) continue;
                walk(fullPath);
            } else if (entry.name.endsWith(".spec.ts")) {
                candidates.push(fullPath);
            }
        }
    };

    walk(dir);

    return candidates.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)[0] ?? null;
}
