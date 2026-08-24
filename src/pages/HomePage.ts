//Home Page - Cinepolis Mexico

import { Page } from "@playwright/test";
import { BasePage } from "./BasePage";
import { FooterComponent } from "../components/FooterComponent";

export class HomePage extends BasePage {
    readonly footer: FooterComponent;

    constructor(page: Page) {
        super(page);
        this.footer = new FooterComponent(page);
    }

    async open(): Promise<void> {
        await this.goto("/mx");
    }
}
