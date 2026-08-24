# Convenciones para Tests de UI

Aplican a todo spec que necesite navegador. Viven en `tests/ui/<modulo>/`.

## Estructura de archivos

```
tests/ui/<modulo>/<tc-id>-<slug>.spec.ts   Spec
src/pages/<Nombre>Page.ts                  Page Object (una vista)
src/components/<Nombre>Component.ts        Componente reutilizable (header, footer, modal)
src/data/<recurso>Factory.ts               Datos con faker
src/fixtures/test.ts                       Registro de fixtures
```

## Anatomía del spec

```typescript
import { test, expect } from "../../../src/fixtures/test";

test.describe("TC-01 - Módulo: comportamiento", () => {
    test.beforeEach(async ({ homePage }) => {
        await homePage.open();
    });

    test("Descripción del comportamiento esperado", { tag: ["@ui", "@smoke"] }, async ({ homePage }) => {
        await test.step("1. Acción del usuario", async () => {
            await homePage.search("Avatar");
        });

        await test.step("2. Resultado esperado", async () => {
            await expect(homePage.resultsHeading).toBeVisible();
        });
    });
});
```

## Reglas

1. El spec **no declara locators**: viven en el Page Object o Component.
2. `test.step()` por cada paso lógico, con descripción en español.
3. Tags inline: `{ tag: ["@ui", "@smoke"] }`. Todo test de UI lleva `@ui`.
4. Locators por prioridad: `getByRole()` > `getByLabel()` > `getByText()` > `getByTestId()`.
   **Nunca** selectores CSS de clases (`.btn-primary`).
5. Page Objects **sin assertions**: exponen locators y acciones; el `expect` va en el spec.
6. Prohibido `waitForTimeout`. Usar auto-waiting de `expect`, `waitForURL` o `waitForLoadState`.
7. Navegación con rutas relativas al `baseURL`, nunca URLs absolutas.
8. Datos de prueba desde factories de `src/data/`; nunca credenciales hardcodeadas.

## Page Object

```typescript
import { Page, Locator } from "@playwright/test";

export class SearchPage {
    readonly page: Page;
    readonly searchInput: Locator;
    readonly resultsRegion: Locator;

    constructor(page: Page) {
        this.page = page;
        this.searchInput = page.getByRole("textbox", { name: /buscar/i });
        this.resultsRegion = page.getByRole("region", { name: /resultados/i });
    }

    async open(): Promise<void> {
        await this.page.goto("/busqueda");
        await this.dismissOverlays();
    }

    async search(query: string): Promise<void> {
        await this.searchInput.fill(query);
        await this.searchInput.press("Enter");
    }

    /** Idempotente: cierra modal promocional y banner de cookies si aparecen. */
    async dismissOverlays(): Promise<void> {
        const closeButton = this.page.getByRole("button", { name: /cerrar|close/i }).first();
        if (await closeButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await closeButton.click();
        }
    }
}
```

## Obstáculos conocidos de este sitio

| Síntoma | Causa | Solución |
| --- | --- | --- |
| Timeout en `toBeVisible()` con locator correcto | Modal promocional intercepta pointer events | `dismissOverlays()` antes de interactuar |
| Click interceptado en el footer | Banner de cookies fijo al pie | Cerrarlo en el mismo helper |
| Heading del footer no existe | Footer con carga diferida | `scrollIntoViewIfNeeded()` sobre `footer` |
| Locator no encontrado con texto idéntico en pantalla | `exact: true` demasiado estricto | Regex case-insensitive en `name` |

## Registro en fixtures

```typescript
type Fixtures = {
    homePage: HomePage;
    searchPage: SearchPage;
};

export const test = base.extend<Fixtures>({
    searchPage: async ({ page }, use) => {
        await use(new SearchPage(page));
    },
});
```
