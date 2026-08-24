import { Page } from "@playwright/test";
import { BasePage } from "./BasePage";
import { FooterComponent } from "../components/FooterComponent";

export class CheckoutPage extends BasePage {
    readonly footer: FooterComponent;

    constructor(page: Page) {
        super(page);
        this.footer = new FooterComponent(page);
    }

    async open(): Promise<void> {
        await this.goto("/checkout");
    }

    /** Idempotente: cierra modal promocional y banner de cookies si aparecen. */
    async dismissOverlays(): Promise<void> {
        const closeButton = this.page.getByRole("button", { name: /cerrar|close/i }).first();
        if (await closeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await closeButton.click();
        }
        // Si hay un banner de cookies, buscar botón de cerrar/aceptar
        const cookiesButton = this.page.getByRole("button", { name: /aceptar|entendido|cerrar|close/i }).first();
        if (await cookiesButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
            await cookiesButton.click();
        }
    }
}
