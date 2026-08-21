import { availableProviders } from "./llm";
import { runAgent, type RunOptions } from "./pipeline";

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
  -h, --help             Esta ayuda

La subcarpeta de tests/ donde cae cada spec se toma del prefijo "[modulo]" en el
titulo del test case (ej. "[footer] Debe mostrar..." -> tests/footer/). Sin ese
prefijo, se infiere del primer tag de dominio, o cae en tests/generated/.

Ejemplos
  npm run agent -- DEMO-1 --source=file --provider=mock
  npm run agent -- DEMO-1 --source=file --provider=gemini
  npm run agent -- CIN-1234 --source=jira --provider=codemie --dry-run
  npm run agent -- CINE-34 --mode=testcase --source=xray --provider=codemie
`;

type ParseResult =
    | { status: "ok"; options: RunOptions }
    | { status: "help" }
    | { status: "error"; message: string };

function parseArgs(argv: string[]): ParseResult {
    const args = argv.slice(2);

    if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
        return { status: "help" };
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
        },
    };
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv);

    if (parsed.status === "help") {
        console.log(HELP);
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

    console.log(`\nArtefactos en: ${result.artifactsDir}`);
    console.log(`   02-test-cases.md   test cases para revision / Jira`);
    console.log(`   04-coverage.md     matriz de trazabilidad`);
    console.log(`   05-report.md       resumen de la corrida`);

    if (failed.length > 0) {
        console.log(
            `\n${failed.length} spec(s) no pasaron la validacion y quedaron como .invalid.`
        );
        process.exitCode = 1;
        return;
    }

    console.log("\nListo.");
}

main().catch((error: unknown) => {
    console.error(`\nEl agente fallo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
