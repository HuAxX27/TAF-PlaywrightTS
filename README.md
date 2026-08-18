# TAF-PlaywrightTS

Framework de automatización en Playwright + TypeScript, con un **agente AQA** que
convierte una User Story en test cases y en specs automatizados, sin duplicar lo
que ya está cubierto.

## Requisitos

- Node 22+ (`.nvmrc`)
- `npm ci`
- `npx playwright install --with-deps` (solo para ejecutar pruebas, no para el agente)

## Configuración

```bash
cp .env.example .env
```

`BASE_URL` es obligatorio. `USER_EMAIL` / `USER_PASSWORD` solo se exigen si una
prueba realmente los usa.

## Comandos

| Comando                           | Qué hace                                    |
| --------------------------------- | ------------------------------------------- |
| `npm test`                        | Corre toda la suite                         |
| `npm run test:smoke`              | Solo `@smoke`                               |
| `npm run test:regression`         | Solo `@regression`                          |
| `npm run test:critical`           | Solo `@critical`                            |
| `npm run test:report`             | Abre el reporte HTML                        |
| `npm run typecheck`               | `tsc --noEmit`                              |
| `npm run lint` / `lint:fix`       | ESLint                                      |
| `npm run format` / `format:check` | Prettier                                    |
| `npm run agent -- <HISTORIA>`     | Agente AQA                                  |
| `npm run agent:demo`              | Agente AQA en modo demo, sin red ni API key |

## Estructura

```
src/
  api/          ApiClient (Playwright request) y servicios por dominio
  components/   Componentes reutilizables de UI (footer, header, ...)
  pages/        Page Objects; BasePage tiene lo común
  data/         Factories con faker
  fixtures/     test.ts: los fixtures que consumen los specs
  config/       env.ts (variables) y paths.ts (storage state)
tests/
  *.spec.ts     Specs revisados por humanos
  generated/    Salida del agente, pendiente de revisión
agent/          El agente AQA (ver agent/README.md)
```

### Convenciones

- Los specs **no** declaran locators: viven en el Page Object o el componente.
- Los specs importan `{ test, expect }` desde `src/fixtures/test`, nunca desde
  `@playwright/test`.
- Cada paso lógico va en un `test.step` con descripción en español.
- Tags con la firma `test("titulo", { tag: ["@smoke"] }, async ({ ... }) => {})`.
- Nada de `waitForTimeout`.

### Login compartido

`tests/auth.setup.ts` es una plantilla. Los archivos `*.setup.ts` están excluidos
de los proyectos de navegador; para activarlos descomenta el proyecto `setup` en
[playwright.config.ts](playwright.config.ts) y agrega `dependencies: ["setup"]` +
`storageState: STORAGE_STATE` a los proyectos que necesiten sesión.

## Agente AQA

```bash
npm run agent:demo
```

```
User Story (Jira o archivo)
   → test cases            (LLM)
   → inventario de tests   (playwright test --list)
   → análisis de cobertura (LLM)  covered / partial / missing
   → specs para lo faltante (LLM)
   → validación real: tsc + eslint + playwright --list, con reintentos de reparación
```

El proveedor de IA es intercambiable desde el `.env` (`LLM_PROVIDER`): `mock`
(offline), `gemini`, `groq`, `openrouter` y `ollama` son gratuitos; `codemie` es
el corporativo.

- **[Guía de uso paso a paso](agent/GUIA.md)** — empieza aquí
- [Referencia de flags y proveedores](agent/README.md)
