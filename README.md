# TAF-PlaywrightTS

Framework de Playwright + TypeScript cuyo producto principal es un **agente AQA**:
convierte Test Cases existentes de Xray en candidates de automatización trazables
y validados.

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

| Comando                                | Qué hace                                      |
| -------------------------------------- | --------------------------------------------- |
| `npm test`                             | Corre toda la suite                           |
| `npm run test:smoke`                   | Solo `@smoke`                                 |
| `npm run test:regression`              | Solo `@regression`                            |
| `npm run test:critical`                | Solo `@critical`                              |
| `npm run test:report`                  | Abre el reporte HTML                          |
| `npm run typecheck`                    | `tsc --noEmit`                                |
| `npm run lint` / `lint:fix`            | ESLint                                        |
| `npm run format` / `format:check`      | Prettier                                      |
| `npm run agent -- <CLAVE> [flags]`     | Candidate desde un Test Case de Xray          |
| `npm run agent -- --test-plan=<CLAVE>` | Candidates de todos los Tests de un Test Plan |
| `npm run agent -- --jql="..."`         | Candidates de un lote Xray con JQL            |

## Estructura

```
src/
  api/          ApiClient (Playwright request) y servicios por dominio
  components/   Componentes reutilizables de UI creados desde TCs reales
  pages/        Page Objects; BasePage tiene lo común
  data/         Factories con faker
  fixtures/     test.ts: los fixtures que consumen los specs
  config/       Variables de ambiente
tests/
  *.spec.ts       Specs escritos a mano
  ui|api/         Specs aprobados que ejecuta la regresión
  candidates/     Specs generados que se validan aislados antes de promoverlos
agent/          El agente AQA (ver agent/README.md)
```

### Convenciones

- Los specs **no** declaran locators: viven en el Page Object o el componente.
- Los specs importan `{ test, expect }` desde `src/fixtures/test`, nunca desde
  `@playwright/test`.
- Cada paso lógico va en un `test.step` con descripción en español.
- Tags con la firma `test("titulo", { tag: ["@smoke"] }, async ({ ... }) => {})`.
- Nada de `waitForTimeout`.

## Agente AQA

```bash
npm run agent -- PROJ-123 --provider=codemie
npm run agent -- --test-plan=PROJ-PLAN-7 --provider=codemie
```

```
Test Case(s) de Xray
   → plan de automatización → inventario de tests (playwright test --list)
   → análisis de cobertura   (LLM)  covered / partial / missing
   → exploración en vivo guiada por el plan
   → candidate + validación estática/E2E/revisión
```

El proveedor de IA es intercambiable desde el `.env` (`LLM_PROVIDER`). `codemie`
es el proveedor productivo predeterminado.

- **[Guía operativa del agente Xray](agent/README.md)** — empieza aquí
