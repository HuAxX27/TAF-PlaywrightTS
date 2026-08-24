import { test as base } from "@playwright/test";
import { HomePage } from "../pages/HomePage";
import { CarteleraPage } from "../pages/CarteleraPage";
import { CheckoutPage } from "../pages/CheckoutPage";
import { ApiClient } from "../api/apiClient";
import { UserService } from "../api/services/userService";
import { CdnService } from "../api/services/cdnService";

type Fixtures = {
    homePage: HomePage;
    carteleraPage: CarteleraPage;
    checkoutPage: CheckoutPage;
    apiClient: ApiClient;
    userService: UserService;
    cdnService: CdnService;
};

export const test = base.extend<Fixtures>({
    //Page Objects
    homePage: async ({ page }, use) => {
        await use(new HomePage(page));
    },
    carteleraPage: async ({ page }, use) => {
        await use(new CarteleraPage(page));
    },
    checkoutPage: async ({ page }, use) => {
        await use(new CheckoutPage(page));
    },

    //Api Client
    // El destructuring vacio es el idiom de Playwright para "este fixture no
    // depende de ningun otro"; no-empty-pattern no lo entiende.
    // eslint-disable-next-line no-empty-pattern
    apiClient: async ({}, use) => {
        const client = await ApiClient.create();
        await use(client);
        await client.dispose();
    },

    userService: async ({ apiClient }, use) => {
        await use(new UserService(apiClient));
    },

    cdnService: async ({ apiClient }, use) => {
        await use(new CdnService(apiClient));
    },
});

export { expect } from "@playwright/test";
