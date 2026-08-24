import { AbortedByHumanError, runAgent } from "./pipeline";

const HELP = `
CreateTestScript - genera el spec de Playwright (+ Page Objects/Services/fixtures que falten)
para un Test Case ya definido en Xray.

  npm run createTestScript -- <CLAVE-XRAY> [--yes]

Ejemplo
  npm run createTestScript -- CINE-34

Opciones
  --yes   No interactivo: acepta los supuestos del agente y aprueba solo (para CI).

Por defecto el agente te pregunta lo que tendria que asumir, espera tu aprobacion
antes y despues de generar el codigo, y al cerrar compara el test case original
contra el spec generado.

El test case se clasifica como UI o API: el spec cae en tests/ui/<modulo>/ o
tests/api/<modulo>/ con las convenciones correspondientes.

Siempre usa --mode=testcase --source=xray --provider=codemie. Para otras
combinaciones (User Story, otro proveedor, dry-run, etc.) usa:
  npm run agent -- <CLAVE> [opciones]

Al finalizar, genera automáticamente un reporte de aprendizaje.
`;

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const key = args.find((arg) => !arg.startsWith("--"));

    if (!key || args.includes("-h") || args.includes("--help")) {
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
        nonInteractive: args.includes("--yes"),
    });

    const failed = result.generated.filter((spec) => !spec.validation.ok);
    const incomplete = result.finalValidations.filter((item) => !item.fullyCovered);

    console.log(`\nArtefactos en: ${result.artifactsDir}`);
    console.log(`   02-test-cases.md        test case importado de Xray (con tus aportes)`);
    console.log(`   04-coverage.md          analisis de cobertura`);
    console.log(`   05-report.md            resumen de la corrida`);
    if (result.finalValidations.length > 0) {
        console.log(`   06-final-validation.md  TC original vs codigo generado`);
    }

    if (failed.length > 0) {
        console.log(`\n${failed.length} spec(s) requieren revision manual:`);
        for (const spec of failed) {
            console.log(`   ${spec.filePath}`);
            const analysis = spec.validation.e2eValidation?.multiAgentAnalysis;
            if (analysis?.rootCause) {
                console.log(`     causa raiz: ${analysis.rootCause}`);
            }
            for (const fix of analysis?.suggestedFixes ?? []) {
                console.log(`     sugerencia: ${fix}`);
            }
        }
        console.log(
            "\nEl spec quedo en su carpeta con el diagnostico en el encabezado y marcado como test.fixme.\nCorrige lo indicado y cambia test.fixme( por test( para reactivarlo."
        );
        process.exitCode = 1;
    } else if (incomplete.length > 0) {
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
    } else {
        console.log("\nListo. Corre `npx playwright test` y valida el resultado.");
    }

    console.log(
        `\n📊 ${result.learning.newRules} regla(s), ${result.learning.newRecipes} receta(s) y ${result.learning.newFacts} hecho(s) nuevo(s) en agent/knowledge/KNOWLEDGE.md`
    );
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
