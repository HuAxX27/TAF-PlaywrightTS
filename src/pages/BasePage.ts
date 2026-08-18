import { Page, Locator } from "@playwright/test";

export abstract class BasePage {
    constructor(protected readonly page: Page) {}

    async goto(path: string): Promise<void> {
        await this.page.goto(path, { waitUntil: "domcontentloaded" });
    }

    async openTyCDocument(linkLocator: Locator) {
        const [documentPage, documentResponse] = await Promise.all([
            this.page.context().waitForEvent("page"),
            this.page.context().waitForEvent("response", (response) => {
                const url = response.url();
                return (
                    url.includes("pimcore-content.cinepolis.com/assets/") &&
                    url.includes("/Legales/")
                );
            }),
            linkLocator.click(),
        ]);
        return { documentPage, documentResponse };
    }
}
