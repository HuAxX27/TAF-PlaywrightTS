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

| Comando                                    | Qué hace                                |
| ------------------------------------------ | --------------------------------------- |
| `npm test`                                 | Corre toda la suite                     |
| `npm run test:smoke`                       | Solo `@smoke`                           |
| `npm run test:regression`                  | Solo `@regression`                      |
| `npm run test:critical`                    | Solo `@critical`                        |
| `npm run test:report`                      | Abre el reporte HTML                    |
| `npm run typecheck`                        | `tsc --noEmit`                          |
| `npm run lint` / `lint:fix`                | ESLint                                  |
| `npm run format` / `format:check`          | Prettier                                |
| `npm run aqa:toolkit -- help`              | Helpers deterministas usados por Claude |
| `npm run candidates`                       | Estado JSON de todos los candidates     |
| `npm run promote -- --paths=... --confirm` | Promoción CLI transaccional             |

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

## Toolkit AQA con Claude Code

```bash
claude
```

Usa slash commands dentro de Claude:

```text
/aqa-generate PROJ-123
/aqa-generate keys:PROJ-123,PROJ-124
/aqa-generate plan:PROJ-PLAN-7
/aqa-candidates
/aqa-repair tests/candidates/ui/account/PROJ-123-profile.spec.ts
/aqa-promote all
```

`/aqa-generate` coordina agentes optimizados: Opus para orquestación batch y validación final,
Sonnet para análisis/codegen/reparación, y Haiku para clasificación mecánica.
La obtención Xray, inventario, ejecución y promoción siguen siendo helpers
TypeScript deterministas y auditables.

- **[Guía del toolkit Claude AQA](agent/README.md)** — arquitectura, comandos y operación
