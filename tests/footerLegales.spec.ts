// tests/footer.spec.ts
import { test, expect } from "../src/fixtures/test";
import { HomePage } from "../src/pages/HomePage";

const LEGAL_LINKS = [
    {
        sectionName: "Generales",
        expectedPdf: "terminos-condiciones-cinepolis.pdf",
        getLocator: (homePage: HomePage) => homePage.footer.terminosYCondicionesGeneralesLink,
    },
    {
        sectionName: "Cineticket",
        expectedPdf: "terminos-condiciones-cinepolis_cineticket.pdf",
        getLocator: (homePage: HomePage) => homePage.footer.terminosYCondicionesCineticketLink,
    },
    {
        sectionName: "Aviso de privacidad",
        expectedPdf: "aviso-de-privacidad-cinepolis.pdf",
        getLocator: (homePage: HomePage) => homePage.footer.avisoPrivacidadLink,
    },
];

test.describe("Footer - Legales", () => {
    test.beforeEach(async ({ homePage }) => {
        await test.step("Navegar al estado inicial de la página", async () => {
            await homePage.open();
        });
    });

    for (const linkData of LEGAL_LINKS) {
        test.describe(`Sección: ${linkData.sectionName}`, () => {
            test(
                `Debe mostrar la opción de Términos y condiciones con los atributos correctos`,
                { tag: ["@smoke", "@homePage", "@footer"] },
                async ({ homePage }) => {
                    const locator = linkData.getLocator(homePage);

                    await test.step("Validar atributos del enlace en la interfaz", async () => {
                        await expect(locator).toBeVisible();
                        await expect(locator).toHaveAttribute(
                            "href",
                            new RegExp(linkData.expectedPdf)
                        );
                        await expect(locator).toHaveAttribute("target", "_blank");
                    });
                }
            );

            test(
                `Debe abrir el PDF en una nueva pestaña al hacer click`,
                { tag: ["@smoke", "@homePage", "@footer"] },
                async ({ homePage }) => {
                    const locator = linkData.getLocator(homePage);

                    const { documentPage, documentResponse } =
                        await test.step("Ejecutar apertura e interceptar la respuesta de red", async () => {
                            return await homePage.openTyCDocument(locator);
                        });

                    await test.step("Validar la integridad y meta-datos del archivo descargado", async () => {
                        expect
                            .soft(documentResponse.status(), "El status HTTP no es 200")
                            .toBe(200);
                        expect
                            .soft(
                                documentResponse.headers()["content-type"],
                                "El Content-Type no es de un PDF"
                            )
                            .toContain("application/pdf");
                        expect
                            .soft(documentResponse.url(), "La URL del documento es incorrecta")
                            .toContain(linkData.expectedPdf);
                    });

                    await test.step("Teardown: Limpiar contexto", async () => {
                        await documentPage.close();
                    });
                }
            );
        });
    }
});
