import { chromium } from "@playwright/test";
import { agentConfig } from "../config";

interface PageExploration {
    /** URL final tras cualquier redireccion o click de trigger. */
    url: string;
    title: string;
    /** Snapshot de accesibilidad en modo IA: incluye [ref=eN] por elemento. */
    ariaSnapshot: string;
    /** Texto del elemento que se hizo click para revelar la UI (login, modal, etc). */
    triggeredAction?: string;
    /** Errores/advertencias visibles al explorar; no bloquean, solo informan. */
    warning?: string;
}

/**
 * Abre `startPath` en un navegador headless real. Si `triggerPatterns` viene
 * dado, intenta hacer click en el primer boton/link cuyo nombre accesible
 * matchee (ej. "Iniciar sesion" para revelar un formulario de login que no
 * vive en la home), y captura el snapshot DESPUES de esa accion.
 *
 * Le da al agente los locators y textos REALES del sitio en vez de que los
 * adivine, que es la causa principal de los TODO en el codigo generado.
 */
export async function explorePage(
    startPath: string,
    triggerPatterns: RegExp[] = []
): Promise<PageExploration> {
    const baseURL = process.env.BASE_URL;
    if (!baseURL) {
        return {
            url: startPath,
            title: "",
            ariaSnapshot: "",
            warning: "Falta BASE_URL en el .env.",
        };
    }

    const browser = await chromium.launch();
    try {
        const context = await browser.newContext({ baseURL });
        const page = await context.newPage();

        try {
            await page.goto(startPath, {
                waitUntil: "domcontentloaded",
                timeout: agentConfig.timeoutMs,
            });
        } catch (error) {
            return {
                url: startPath,
                title: "",
                ariaSnapshot: "",
                warning: `No se pudo cargar "${startPath}": ${error instanceof Error ? error.message : String(error)}`,
            };
        }

        // Le da tiempo a la app a hidratar/renderizar antes de tomar la foto.
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

        const triggeredAction = await clickFirstMatch(page, triggerPatterns);
        if (triggeredAction) {
            await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        }

        const [ariaSnapshot, title] = await Promise.all([
            page.locator("body").ariaSnapshot({ mode: "ai" }),
            page.title(),
        ]);

        return { url: page.url(), title, ariaSnapshot, triggeredAction };
    } finally {
        await browser.close();
    }
}

/** Intenta click en el primer boton/link visible cuyo nombre accesible matchee algun patron. */
async function clickFirstMatch(
    page: import("@playwright/test").Page,
    patterns: RegExp[]
): Promise<string | undefined> {
    for (const pattern of patterns) {
        const candidate = page
            .getByRole("button", { name: pattern })
            .or(page.getByRole("link", { name: pattern }))
            .first();

        try {
            if ((await candidate.count()) === 0) continue;
            const name = (await candidate.textContent())?.trim() || pattern.source;
            await candidate.click({ timeout: 5_000 });
            return name;
        } catch {
            continue;
        }
    }
    return undefined;
}
