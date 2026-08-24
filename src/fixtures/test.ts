import { test as base } from "@playwright/test";
import { ApiClient } from "../api/apiClient";
import { FooterComponent } from "../components/FooterComponent";

type Fixtures = {
    apiClient: ApiClient;
    footerComponent: FooterComponent;
};

export const test = base.extend<Fixtures>({
    // Cliente HTTP generico. Los fixtures de dominio se agregan cuando los TCs
    // reales requieran Page Objects o Services concretos.
    // eslint-disable-next-line no-empty-pattern
    apiClient: async ({}, use) => {
        const client = await ApiClient.create();
        await use(client);
        await client.dispose();
    },

    footerComponent: async ({ page }, use) => {
        const footerComponent = new FooterComponent(page);
        await use(footerComponent);
    },
});

export { expect } from "@playwright/test";
