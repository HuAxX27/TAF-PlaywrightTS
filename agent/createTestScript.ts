import { runAgent } from "./pipeline";

const HELP = `
CreateTestScript - genera el spec de Playwright (+ Page Objects/fixtures que falten)
para un Test Case ya definido en Xray.

  npm run createTestScript -- <CLAVE-XRAY>

Ejemplo
  npm run createTestScript -- CINE-34

Siempre usa --mode=testcase --source=xray --provider=codemie. Para otras
combinaciones (User Story, otro proveedor, dry-run, etc.) usa:
  npm run agent -- <CLAVE> [opciones]
`;

async function main(): Promise<void> {
    const key = process.argv[2];

    if (!key || key === "-h" || key === "--help") {
        console.log(HELP);
        process.exitCode = key ? 0 : 1;
        return;
    }

    const result = await runAgent({
        storyKey: key,
        mode: "testcase",
        source: "xray",
        provider: "codemie",
        // El punto de este comando es obtener el spec de ESE TC puntual, aunque
        // el analisis de cobertura detecte una prueba parecida existente.
        includePartial: true,
    });

    const failed = result.generated.filter((spec) => !spec.validation.ok);

    console.log(`\nArtefactos en: ${result.artifactsDir}`);
    console.log(`   02-test-cases.md   test case importado de Xray`);
    console.log(`   04-coverage.md     analisis de cobertura`);
    console.log(`   05-report.md       resumen de la corrida`);

    if (failed.length > 0) {
        console.log(
            `\n${failed.length} spec(s) no pasaron la validacion y quedaron como .invalid.`
        );
        process.exitCode = 1;
        return;
    }

    console.log("\nListo. Corre `npx playwright test` y valida el resultado.");
}

main().catch((error: unknown) => {
    console.error(`\nEl agente fallo: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
