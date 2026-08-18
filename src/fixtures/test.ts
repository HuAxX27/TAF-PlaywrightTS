import { test as base} from "@playwright/test"
import { HomePage } from "../pages/HomePage"
import { ApiClient } from "../api/apiClient"
import { UserService } from "../api/services/userService"

type Fixtures = {
    homePage: HomePage;
    apiClient: ApiClient;
    userService: UserService;
};

export const test = base.extend<Fixtures>({
    //Page Objects
    homePage: async ({ page }, use) => {
        await use(new HomePage(page));
    },

    //Api Client
    apiClient: async ({}, use) => {
        const client = await ApiClient.create();
        await use(client);
        await client.dispose();
    },

    userService: async ({ apiClient}, use) => {
        await use(new UserService(apiClient));
    },
});

export { expect } from "@playwright/test";