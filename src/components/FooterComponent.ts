import { Page, Locator } from "@playwright/test";

export class FooterComponent {
    //Legales
    readonly legalesHeading: Locator;
    readonly terminosYCondicionesGeneralesLink: Locator;
    readonly terminosYCondicionesCineticketLink: Locator;
    readonly avisoPrivacidadLink: Locator;
    readonly terminosCinecashLink: Locator;
    readonly terminosYCondicionesGarantiaCinepolisLink: Locator;
    readonly formatoReclamoGarantiaCinepolisLink: Locator;

    //Politicas

    constructor(private readonly page: Page) {
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
}
