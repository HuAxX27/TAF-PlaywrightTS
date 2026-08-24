import { Page, Locator } from "@playwright/test";

export class FooterComponent {
    readonly page: Page;
    readonly container: Locator;
    //Legales
    readonly legalesHeading: Locator;
    readonly terminosYCondicionesGeneralesLink: Locator;
    readonly terminosYCondicionesCineticketLink: Locator;
    readonly avisoPrivacidadLink: Locator;
    readonly terminosCinecashLink: Locator;
    readonly terminosYCondicionesGarantiaCinepolisLink: Locator;
    readonly formatoReclamoGarantiaCinepolisLink: Locator;

    constructor(page: Page) {
        this.page = page;
        this.container = page.locator("footer");
        this.legalesHeading = page.getByText("Legales", { exact: true });
        this.terminosYCondicionesGeneralesLink = page.getByRole("link", {
            name: "Términos y condiciones",
            exact: true,
        });
        this.terminosYCondicionesCineticketLink = page.getByRole("link", {
            name: "Términos y condiciones Cineticket",
            exact: true,
        });
        this.avisoPrivacidadLink = page.getByRole("link", {
            name: "Aviso de privacidad",
            exact: true,
        });
        this.terminosCinecashLink = page.getByRole("link", {
            name: "Términos Cinecash",
            exact: true,
        });
        this.terminosYCondicionesGarantiaCinepolisLink = page.getByRole("link", {
            name: "Términos y Condiciones Garantía Cinépolis",
            exact: true,
        });
        this.formatoReclamoGarantiaCinepolisLink = page.getByRole("link", {
            name: "Formato de reclamo Garantía Cinépolis",
            exact: true,
        });
    }

    async scrollIntoView(): Promise<void> {
        await this.container.scrollIntoViewIfNeeded();
        // Esperar a que el heading "Legales" esté presente tras el scroll
        await this.legalesHeading.waitFor({ state: "visible", timeout: 5000 });
    }
}
