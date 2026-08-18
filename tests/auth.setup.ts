//EXAMPLE

import {test as setup} from "@playwright/test";
import {env} from "../src/config/env";
import { STORAGE_STATE } from "../src/config/paths";

setup("authenticate", async ({page}) => {
    
    await page.goto("/login");

    await page.getByLabel("Email").fill(env.credentials.email);
    await page.getByLabel("Password").fill(env.credentials.password);
    await page.getByRole("button", {name: "Sign in"}).click();

    await page.waitForURL("/homePage");

    await page.context().storageState({path: STORAGE_STATE});

})