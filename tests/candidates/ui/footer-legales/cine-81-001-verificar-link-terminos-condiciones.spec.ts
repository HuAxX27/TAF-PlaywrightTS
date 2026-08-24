// Candidate generado por el Agente AQA - no ejecutar en regresion hasta promoverlo.
import { test, expect } from "../../../../src/fixtures/test";

test("CINE-81 · Verificar link 'Términos y condiciones generales' con target _blank y PDF correcto", {
    tag: ["@qa-generado", "@qa-to-review"]
}, async ({ page, footerComponent }) => {
    
    await test.step("Abrir una página del sitio que tenga footer", async () => {
        await page.goto("/mx", { waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(/\/mx/);
    });

    await test.step("Ubicar la sección 'Legales' en el footer", async () => {
        await footerComponent.scrollToFooter();
        await expect(footerComponent.legalesSection).toBeVisible();
    });

    await test.step("Inspeccionar el enlace 'Términos y condiciones'", async () => {
        const terminosLink = footerComponent.terminosCondicionesLink;
        await expect(terminosLink).toBeVisible();
        await expect(terminosLink).toHaveAttribute("target", "_blank");
    });

    await test.step("Hacer click en 'Términos y condiciones'", async () => {
        const downloadPromise = page.waitForEvent("download");
        await footerComponent.clickTerminosCondiciones();
        const download = await downloadPromise;
        
        const downloadUrl = download.url();
        expect(downloadUrl).toContain(".pdf");
        expect(downloadUrl).toBe("https://pimcore-content.cinepolis.com/assets/Legales/terminos-condiciones-cinepolis.pdf");
    });
});
