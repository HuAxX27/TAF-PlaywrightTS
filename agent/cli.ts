import { availableProviders } from "./llm";
import { AbortedByHumanError, runAgent, type RunOptions } from "./pipeline";
import { generateLearningReport } from "./framework/learning";

const HELP = `
Agente AQA - de la User Story (o de un TC ya definido) a los tests automatizados

  npm run agent -- <CLAVE> [opciones]

Opciones
  --mode=story|testcase  "story" disena TCs desde una User Story (default).
                         "testcase" toma un TC ya definido (p.ej. Xray) y genera el spec directo.
  --source=<nombre>      De donde se lee la clave. modo story: jira|file. modo testcase: xray|file.
                         (default: STORY_SOURCE / TESTCASE_SOURCE del .env, segun el modo)
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

Separacion UI / API
  Cada test case se clasifica como UI o API y el spec cae en tests/ui/<modulo>/ o
  tests/api/<modulo>/, con las convenciones de agent/docs/CONVENTIONS-UI.md o
  CONVENTIONS-API.md. El <modulo> se toma del prefijo "[modulo]" del titulo, del
  primer tag de dominio, o "generated" como ultimo recurso.

Ejemplos
  npm run agent -- DEMO-1 --source=file --provider=mock
  npm run agent -- DEMO-1 --source=file --provider=gemini
  npm run agent -- CIN-1234 --source=jira --provider=codemie --dry-run
  npm run agent -- CINE-34 --mode=testcase --source=xray --provider=codemie
  npm run agent -- CINE-34 --mode=testcase --source=xray --provider=codemie --yes
  npm run agent -- --learning-report
`;

type ParseResult =
    | { status: "ok"; options: RunOptions }
    | { status: "help" }
    | { status: "learning-report" }
    | { status: "error"; message: string };

function parseArgs(argv: string[]): ParseResult {
    const args = argv.slice(2);

    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        return { status: "help" };
    }
    
    // Comando especial para reporte de aprendizaje
    if (args.includes("--learning-report")) {
        return { status: "learning-report" };
    }

    const positional = args.filter((arg) => !arg.startsWith("--"));
    const flag = (name: string): string | undefined =>
        args
            .find((arg) => arg.startsWith(`--${name}=`))
            ?.split("=")
            .slice(1)
            .join("=");

    if (positional.length === 0) {
        return { status: "error", message: "Falta la clave de la historia (por ejemplo: DEMO-1)." };
    }

    const mode = flag("mode");
    if (mode && mode !== "story" && mode !== "testcase") {
        return { status: "error", message: `--mode debe ser "story" o "testcase" (recibido: ${mode}).` };
    }

    return {
        status: "ok",
        options: {
            storyKey: positional[0],
            source: flag("source"),
            provider: flag("provider"),
            mode: mode as RunOptions["mode"],
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

    if (parsed.status === "error") {
        console.error(`\n${parsed.message}`);
        console.log(HELP);
        process.exitCode = 1;
        return;
    }

    const result = await runAgent(parsed.options);

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
            `\n${failed.length} spec(s) requieren revision manual (diagnostico en el encabezado del spec, marcados como test.fixme).`
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

    console.log("\nListo.");
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
