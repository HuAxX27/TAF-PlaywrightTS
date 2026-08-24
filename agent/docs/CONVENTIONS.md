# Convenciones de Código para Generación de Tests

Este archivo define las convenciones y mejores prácticas que el agente debe seguir al generar tests de Playwright.

## Estructura de Archivos

```
tests/
  ├── <modulo>/           # Agrupados por módulo funcional
  │   └── *.spec.ts       # Specs de Playwright
src/
  ├── pages/              # Page Objects (un archivo por página)
  ├── components/         # Componentes reutilizables (header, footer, modals)
  ├── api/                # Cliente API y servicios
  ├── data/               # Factories de datos con Faker
  ├── fixtures/           # Fixtures de Playwright
  └── config/             # Configuración (env, paths)
```

## Convenciones de Specs

### Imports
```typescript
// ✅ CORRECTO: Importar desde el fixture del framework
import { test, expect } from "../../src/fixtures/test";

// ❌ INCORRECTO: Importar directamente de Playwright
import { test, expect } from "@playwright/test";
```

### Estructura del Test
```typescript
test.describe("Módulo - Funcionalidad", () => {
    test("Descripción clara del caso de prueba", { tag: ["@smoke", "@modulo"] }, async ({ page, homePage }) => {
        await test.step("1. Paso descriptivo en español", async () => {
            // Acción
            await homePage.navigate();
            
            // Assertion
            await expect(page).toHaveTitle(/Título esperado/);
        });

        await test.step("2. Siguiente paso descriptivo", async () => {
            // ...
        });
    });
});
```

### Reglas de Specs

1. **Cada paso lógico en `test.step()`** con descripción en español
2. **Tags declarados inline**: `{ tag: ["@smoke", "@regression"] }`
3. **Usar fixtures del framework**, no instanciar Page Objects manualmente
4. **Sin lógica compleja en el spec**: mover a Page Objects o helpers
5. **Assertions con auto-waiting de Playwright**: `expect(locator).toBeVisible()`
6. **Sin hardcodear datos sensibles**: usar factories de `src/data/`

### Prohibiciones Estrictas

```typescript
// ❌ PROHIBIDO: waitForTimeout
await page.waitForTimeout(3000);

// ✅ CORRECTO: Esperar condición específica
await expect(element).toBeVisible();
await page.waitForLoadState("networkidle");

// ❌ PROHIBIDO: Selectores CSS frágiles
await page.locator(".btn-primary").click();

// ✅ CORRECTO: Selectores por rol/texto
await page.getByRole("button", { name: "Iniciar sesión" }).click();

// ❌ PROHIBIDO: try-catch para ocultar errores
try {
    await element.click();
} catch {
    // ignorar
}

// ✅ CORRECTO: Manejar estados opcionales explícitamente
if (await element.isVisible()) {
    await element.click();
}
```

## Convenciones de Page Objects

### Estructura Básica
```typescript
import { Page, Locator } from "@playwright/test";

export class HomePage {
    readonly page: Page;
    
    // Locators como propiedades readonly
    readonly searchInput: Locator;
    readonly searchButton: Locator;
    readonly resultsContainer: Locator;

    constructor(page: Page) {
        this.page = page;
        
        // Locators por rol/texto, NO por CSS
        this.searchInput = page.getByRole("textbox", { name: /buscar/i });
        this.searchButton = page.getByRole("button", { name: "Buscar" });
        this.resultsContainer = page.getByRole("region", { name: "Resultados" });
    }

    // Métodos de navegación
    async navigate() {
        await this.page.goto("/");
    }

    // Métodos de acción (verbos)
    async search(query: string) {
        await this.searchInput.fill(query);
        await this.searchButton.click();
    }

    // Métodos de verificación (retornan Locator para assertions)
    getResultByTitle(title: string): Locator {
        return this.resultsContainer.getByText(title);
    }

    // Métodos de estado (retornan boolean/string)
    async getResultsCount(): Promise<number> {
        return await this.resultsContainer.locator("[role='article']").count();
    }
}
```

### Reglas de Page Objects

1. **Un archivo por página/vista principal**
2. **Locators como propiedades `readonly`**, inicializados en constructor
3. **Métodos de acción retornan `Promise<void>`**
4. **Métodos de verificación retornan `Locator`** (para usar con `expect()`)
5. **Métodos de estado retornan datos** (`Promise<string>`, `Promise<number>`, etc.)
6. **Sin assertions dentro del Page Object**: solo acciones y queries
7. **Usar `getByRole()` preferentemente**, luego `getByText()`, último recurso `getByTestId()`

## Convenciones de Components

Para elementos reutilizables (header, footer, modals, cards):

```typescript
import { Page, Locator } from "@playwright/test";

export class HeaderComponent {
    readonly page: Page;
    readonly container: Locator;
    
    readonly logo: Locator;
    readonly menuButton: Locator;
    readonly userMenu: Locator;

    constructor(page: Page) {
        this.page = page;
        this.container = page.getByRole("banner"); // <header> tag
        
        this.logo = this.container.getByRole("img", { name: /logo/i });
        this.menuButton = this.container.getByRole("button", { name: "Menú" });
        this.userMenu = this.container.getByRole("navigation", { name: "Usuario" });
    }

    async openMenu() {
        await this.menuButton.click();
    }

    async navigateToSection(section: string) {
        await this.container.getByRole("link", { name: section }).click();
    }
}
```

## Convenciones de Datos de Prueba

### Factories con Faker
```typescript
import { faker } from "@faker-js/faker";

export interface User {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
}

export function createUser(overrides?: Partial<User>): User {
    return {
        email: faker.internet.email(),
        password: faker.internet.password({ length: 12 }),
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        ...overrides,
    };
}

// Uso en tests
const user = createUser({ email: "test@example.com" });
```

### Reglas de Datos

1. **Nunca hardcodear credenciales** en specs
2. **Usar factories para datos dinámicos**
3. **Permitir overrides** para casos específicos
4. **Datos sensibles en variables de entorno**

## Convenciones de Fixtures

### Registro de Page Objects
```typescript
import { test as base } from "@playwright/test";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";

type Fixtures = {
    homePage: HomePage;
    loginPage: LoginPage;
};

export const test = base.extend<Fixtures>({
    homePage: async ({ page }, use) => {
        await use(new HomePage(page));
    },
    
    loginPage: async ({ page }, use) => {
        await use(new LoginPage(page));
    },
});

export { expect } from "@playwright/test";
```

## Configuración

### baseURL
```typescript
// Usar baseURL del config, NO URLs absolutas
await page.goto("/login"); // ✅
await page.goto("https://example.com/login"); // ❌
```

### Timeouts
```typescript
// Usar timeouts razonables, NO infinitos
await expect(element).toBeVisible({ timeout: 10_000 }); // ✅
await expect(element).toBeVisible({ timeout: 999_999 }); // ❌
```

## Patrones Comunes

### Login
```typescript
// En un fixture o helper, NO en cada spec
test.beforeEach(async ({ loginPage }) => {
    await loginPage.loginAs(testUser);
});
```

### Esperar Navegación
```typescript
// ✅ CORRECTO
await Promise.all([
    page.waitForURL("/dashboard"),
    page.getByRole("button", { name: "Continuar" }).click(),
]);

// ❌ INCORRECTO
await page.getByRole("button", { name: "Continuar" }).click();
await page.waitForTimeout(2000);
```

### Verificar Múltiples Elementos
```typescript
// ✅ CORRECTO: Assertions en paralelo
await Promise.all([
    expect(header).toBeVisible(),
    expect(footer).toBeVisible(),
    expect(content).toContainText("Bienvenido"),
]);

// ❌ INCORRECTO: Secuencial innecesario
await expect(header).toBeVisible();
await expect(footer).toBeVisible();
await expect(content).toContainText("Bienvenido");
```

## TypeScript

### Tipos Estrictos
```typescript
// ✅ CORRECTO: Tipos explícitos
async function getUser(id: string): Promise<User> {
    // ...
}

// ❌ INCORRECTO: any o sin tipos
async function getUser(id) {
    // ...
}
```

### Null Safety
```typescript
// ✅ CORRECTO: Manejar null/undefined
const text = await element.textContent();
if (text) {
    expect(text).toContain("esperado");
}

// ❌ INCORRECTO: Asumir que no es null
const text = await element.textContent();
expect(text.toLowerCase()).toContain("esperado"); // Puede fallar si text es null
```

## Nomenclatura

### Archivos
- Specs: `kebab-case.spec.ts` (ej: `login-flow.spec.ts`)
- Page Objects: `PascalCase.ts` (ej: `LoginPage.ts`)
- Components: `PascalCase.ts` (ej: `HeaderComponent.ts`)
- Factories: `camelCase.ts` (ej: `userFactory.ts`)

### Variables y Funciones
- Variables: `camelCase`
- Funciones: `camelCase`
- Clases: `PascalCase`
- Constantes: `UPPER_SNAKE_CASE`

### Tests
- Describe: "Módulo - Funcionalidad"
- Test: "Descripción clara del comportamiento esperado"
- Steps: "N. Acción descriptiva en español"

## Ejemplo Completo

```typescript
// tests/search/search-movies.spec.ts
import { test, expect } from "../../src/fixtures/test";

test.describe("Búsqueda - Películas", () => {
    test("Buscar película por nombre retorna resultados relevantes", 
        { tag: ["@smoke", "@search"] }, 
        async ({ page, homePage, searchPage }) => {
        
        await test.step("1. Navegar a la página principal", async () => {
            await homePage.navigate();
            await expect(page).toHaveTitle(/Cinépolis/);
        });

        await test.step("2. Realizar búsqueda de película", async () => {
            await homePage.search("Avatar");
            await expect(page).toHaveURL(/\/search/);
        });

        await test.step("3. Verificar resultados relevantes", async () => {
            const results = searchPage.getResults();
            await expect(results).toHaveCount({ min: 1 });
            await expect(results.first()).toContainText("Avatar");
        });
    });
});
```

## Resumen de Reglas Críticas

1. ✅ Importar desde fixture del framework
2. ✅ Usar `test.step()` para cada paso
3. ✅ Locators por rol/texto, NO CSS
4. ✅ Sin `waitForTimeout`
5. ✅ Sin hardcodear datos sensibles
6. ✅ Page Objects sin assertions
7. ✅ TypeScript strict
8. ✅ Async/await consistente
9. ✅ Tags inline en cada test
10. ✅ baseURL relativo, NO absoluto
