import { test as base } from "@playwright/test";
import { ApiClient } from "../api/apiClient";

type Fixtures = {
    apiClient: ApiClient;
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
});

export { expect } from "@playwright/test";
