import { Page, Locator } from "@playwright/test";

export class FooterComponent {
    readonly page: Page;
    readonly footer: Locator;
    readonly legalesSection: Locator;
    readonly terminosCondicionesLink: Locator;

    constructor(page: Page) {
        this.page = page;
        this.footer = page.locator("footer");
        this.legalesSection = this.footer.getByText("Legales").locator("..");
        this.terminosCondicionesLink = this.footer.getByRole("link", {
            name: "Términos y condiciones",
            exact: true,
        });
    }

    async scrollToFooter(): Promise<void> {
        await this.footer.scrollIntoViewIfNeeded();
    }

    async clickTerminosCondiciones(): Promise<void> {
        await this.terminosCondicionesLink.click();
    }
}
