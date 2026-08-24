import { availableProviders } from "./llm";
import { AbortedByHumanError, runAgent, type RunOptions } from "./pipeline";
import { generateLearningReport } from "./framework/learning";
import { printCandidateStatus, runMainWizard, runPromotionWizard } from "./framework/interactive";
import { promoteCandidates } from "./framework/promotion";

const HELP = `
Agente AQA - de Test Cases de Xray a candidates de Playwright

  npm run agent            Abre el asistente guiado (recomendado)
  npm run promote          Promueve uno o varios candidates listos
  npm run candidates       Muestra el estado de todos los candidates

Uso avanzado
  npm run agent -- <CLAVE-XRAY> [opciones]

Opciones
  --jql=<consulta>        Genera candidates para hasta 100 Tests que coincidan con JQL.
  --test-plan=<CLAVE>     Genera candidates para los Tests de un Test Plan de Xray.
  --keys=A,B,C            Genera candidates para varias claves Xray.
  --promote=<ruta>        Promueve un candidate revisado a tests/ui o tests/api.
  --provider=<nombre>    Proveedor de IA: ${availableProviders().join(" | ")}
  --dry-run              Analiza y reporta, pero no escribe ningun spec
  --include-partial      Tambien genera codigo para los casos cubiertos a medias
  --yes                  No interactivo: acepta los supuestos del agente y aprueba solo (CI)
  --learning-report      Genera reporte de aprendizaje del agente
  -h, --help             Esta ayuda

Involucramiento humano (por defecto activo, se apaga con --yes)
  1. El agente pregunta todo lo que tendria que asumir y aplica tus respuestas a los TCs.
  2. No genera codigo hasta que apruebas los test cases; puedes pedir cambios las veces que haga falta.
  3. Aprueba cada spec generado, o pide que se regenere con tu feedback.
  4. Al cerrar, compara el TC original contra el codigo y te muestra que escenarios quedaron sin cubrir.

Salida segura
  Cada test case se clasifica como UI o API y genera un candidate en
  tests/candidates/<ui|api>/<modulo>/. La suite normal los ignora; el agente los
  ejecuta con AQA_INCLUDE_CANDIDATES=true durante la validacion.

Ejemplos
  npm run agent -- PROJ-123 --provider=codemie
  npm run agent -- --keys=PROJ-123,PROJ-124 --provider=codemie --yes
  npm run agent -- --test-plan=PROJ-PLAN-7 --provider=codemie
  npm run agent -- --jql="project = PROJ AND labels = regression" --dry-run
  npm run agent -- --promote=tests/candidates/ui/account/PROJ-123-profile.spec.ts
  npm run agent -- --learning-report
`;

type ParseResult =
    | { status: "ok"; options: RunOptions }
    | { status: "help" }
    | { status: "learning-report" }
    | { status: "wizard" }
    | { status: "promotion-wizard" }
    | { status: "candidates" }
    | { status: "promote"; candidatePath: string }
    | { status: "error"; message: string };

function parseArgs(argv: string[]): ParseResult {
    const args = argv.slice(2);

    if (args.length === 0) {
        return process.stdin.isTTY === true ? { status: "wizard" } : { status: "help" };
    }
    if (args.includes("-h") || args.includes("--help")) {
        return { status: "help" };
    }

    if (args.length === 1 && args[0] === "promote") {
        return { status: "promotion-wizard" };
    }
    if (args.length === 1 && args[0] === "candidates") {
        return { status: "candidates" };
    }

    // Comando especial para reporte de aprendizaje
    if (args.includes("--learning-report")) {
        return { status: "learning-report" };
    }

    const promotion = args.find((arg) => arg.startsWith("--promote="));
    if (promotion) {
        return { status: "promote", candidatePath: promotion.slice("--promote=".length).trim() };
    }

    const positional = args.filter((arg) => !arg.startsWith("--"));
    const flag = (name: string): string | undefined =>
        args
            .find((arg) => arg.startsWith(`--${name}=`))
            ?.split("=")
            .slice(1)
            .join("=");

    const jql = flag("jql");
    const testPlan = flag("test-plan");
    const keys = flag("keys");
    const selectors = [jql, testPlan, keys].filter(Boolean);

    if (selectors.length > 1 || (selectors.length > 0 && positional.length > 0)) {
        return {
            status: "error",
            message: "Usa una sola entrada: clave, --jql, --test-plan o --keys.",
        };
    }
    if (selectors.length === 0 && positional.length !== 1) {
        return {
            status: "error",
            message: "Indica una clave Xray o uno de --jql, --test-plan, --keys.",
        };
    }

    const selector = jql
        ? `jql:${jql}`
        : testPlan
          ? `plan:${testPlan}`
          : keys
            ? `keys:${keys}`
            : positional[0];

    return {
        status: "ok",
        options: {
            selector,
            provider: flag("provider"),
            dryRun: args.includes("--dry-run"),
            includePartial: args.includes("--include-partial"),
            nonInteractive: args.includes("--yes"),
        },
    };
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);

    if (parsed.status === "help") {
        console.log(HELP);
        return;
    }

    if (parsed.status === "learning-report") {
        console.log("\nBase de conocimiento del agente (agent/knowledge/KNOWLEDGE.md):\n");
        console.log(generateLearningReport());
        console.log(
            "\nEste archivo vive en agent/knowledge/ y se versiona en git: compartelo con el equipo."
        );
        return;
    }

    if (parsed.status === "wizard") {
        const action = await runMainWizard();
        if (action.kind === "done") return;
        await executeAgent(action.options);
        return;
    }

    if (parsed.status === "promotion-wizard") {
        await runPromotionWizard();
        return;
    }

    if (parsed.status === "candidates") {
        printCandidateStatus();
        return;
    }

    if (parsed.status === "promote") {
        const promoted = promoteCandidates([parsed.candidatePath]);
        promoted.forEach((item) => console.log(`\nPromovido: ${item.target}`));
        return;
    }

    if (parsed.status === "error") {
        console.error(`\n${parsed.message}`);
        console.log(HELP);
        process.exitCode = 1;
        return;
    }

    await executeAgent(parsed.options);
}

async function executeAgent(options: RunOptions): Promise<void> {
    const result = await runAgent(options);

    const failed = result.generated.filter((spec) => !spec.validation.ok);
    const incomplete = result.finalValidations.filter((item) => !item.fullyCovered);

    console.log(`\nArtefactos en: ${result.artifactsDir}`);
    console.log(`   02-test-cases.md        test cases aprobados (para Jira/Xray)`);
    console.log(`   04-coverage.md          matriz de trazabilidad`);
    console.log(`   05-report.md            resumen de la corrida`);
    if (result.finalValidations.length > 0) {
        console.log(`   06-final-validation.md  TC original vs codigo generado`);
    }
    if (result.humanReview.length > 0) {
        console.log(`   07-human-review.json    preguntas, respuestas y aprobaciones`);
    }

    if (failed.length > 0) {
        console.log(
            `\n${failed.length} candidate(s) requieren revision manual; no entraron a la suite aprobada.`
        );
        process.exitCode = 1;
        return;
    }

    if (incomplete.length > 0) {
        console.log(
            `\n${incomplete.length} spec(s) no cubren todos los escenarios del test case original:`
        );
        for (const item of incomplete) {
            console.log(`   ${item.testCaseId} (${item.coveragePercent}%)`);
            for (const missing of item.missingScenarios.slice(0, 3)) {
                console.log(`     falta: ${missing}`);
            }
        }
        console.log("\nDetalle completo en 06-final-validation.md");
        process.exitCode = 1;
        return;
    }

    console.log("\nCandidates listos. Promuevelos solo despues de revisar el reporte y el diff.");
}

main().catch((error: unknown) => {
    if (error instanceof AbortedByHumanError) {
        console.log(`\n${error.message}`);
        process.exitCode = 130;
        return;
    }
    console.error(`\nEl agente fallo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
