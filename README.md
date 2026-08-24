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

| Comando                           | Qué hace                                     |
| --------------------------------- | -------------------------------------------- |
| `npm test`                        | Corre toda la suite                          |
| `npm run test:smoke`              | Solo `@smoke`                                |
| `npm run test:regression`         | Solo `@regression`                           |
| `npm run test:critical`           | Solo `@critical`                             |
| `npm run test:report`             | Abre el reporte HTML                         |
| `npm run typecheck`               | `tsc --noEmit`                               |
| `npm run lint` / `lint:fix`       | ESLint                                       |
| `npm run format` / `format:check` | Prettier                                     |
| `npm run agent`                   | Asistente guiado para generar desde Xray     |
| `npm run candidates`              | Estado y motivo de bloqueo de cada candidate |
| `npm run promote`                 | Promoción guiada de uno o varios candidates  |

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
npm run agent
```

El asistente pregunta si deseas usar una clave, varias claves, un Test Plan o
JQL. No es necesario aprender parámetros. Al finalizar, `npm run candidates`
muestra qué archivos están listos y `npm run promote` permite seleccionar uno,
varios, un rango o todos.

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
