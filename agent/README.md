# Agente AQA: Xray a Playwright

El agente convierte **Test Cases existentes de Xray Cloud** en candidates de
Playwright. No diseña pruebas desde User Stories: Xray es la fuente de verdad de
requisitos, pasos y resultados esperados.

## Flujo de calidad

```text
Xray Test / Test Plan / JQL
  -> normalización + clasificación UI/API
  -> plan de automatización auditable
  -> inventario de cobertura + exploración de la aplicación
  -> candidate de código
  -> Playwright --list + TypeScript + ESLint + E2E + revisor
  -> revisión humana y promoción a la suite aprobada
```

Un candidate se escribe en `tests/candidates/` y queda excluido de `npm test`.
El agente lo habilita únicamente para validarlo. Nunca debe confundirse un
archivo con `TODO`, `test.fixme` o una validación fallida con una prueba aprobada.

## Configuración

```bash
npm ci
npx playwright install --with-deps
cp .env.example .env
```

Configura `BASE_URL`, `XRAY_CLIENT_ID`, `XRAY_CLIENT_SECRET`, `CODEMIE_API_KEY`
y el identificador corporativo de Sonnet:

```dotenv
LLM_PROVIDER=codemie
LLM_MODEL=<id-de-sonnet-4.5-en-codemie>
LLM_TEMPERATURE=0.1
```

## Uso

El flujo recomendado no necesita parámetros:

```bash
npm run agent
```

El asistente muestra estas opciones:

1. Generar pruebas desde Xray.
2. Ver el estado de los candidates.
3. Promover candidates listos.

Para consultar el estado en cualquier momento:

```bash
npm run candidates
```

Para promover uno, varios, un rango o todos los candidates listos:

```bash
npm run promote
```

La promoción sólo ofrece candidates con validación E2E aprobada y cobertura
completa. Corrige automáticamente el import relativo al mover el spec, vuelve a
validarlo y revierte el lote completo si alguno falla. Cada promoción deja una
auditoría en `agent/artifacts/promotions/`.

### Uso avanzado

Los parámetros continúan disponibles para CI o usuarios experimentados:

```bash
# Un Test Case
npm run agent -- PROJ-123 --provider=codemie

# Varios Tests concretos
npm run agent -- --keys=PROJ-123,PROJ-124 --provider=codemie --yes

# Todos los Tests de un Test Plan (máximo 100 por llamada Xray)
npm run agent -- --test-plan=PROJ-PLAN-7 --provider=codemie

# Lote definido por JQL
npm run agent -- --jql="project = PROJ AND labels = regression" --provider=codemie
```

Usa `--dry-run` para obtener clasificación, plan e inventario sin escribir
candidates. `--include-partial` incluye casos que la cobertura marque como
parcial. `--yes` desactiva preguntas interactivas para CI.

## Artefactos

Cada ejecución deja una carpeta en `agent/artifacts/<run-id>/`:

- `00-run.json`: selector Xray, modelo y configuración de la corrida.
- `02-test-cases.*`: Test Cases importados de Xray.
- `02b-kind-decisions.json`: clasificación UI/API.
- `03-inventory.json`: pruebas existentes detectadas.
- `04-coverage.*`: trazabilidad contra cobertura actual.
- `05-automation-plans.json`: plan antes de generar código.
- `05-report.md`: resumen de la corrida.
- `06-final-validation.*`: cobertura del TC contra el candidate generado.
- `07-human-review.json`: decisiones y excepciones humanas.
- `08-candidate-manifest.json`: estado de cada candidate para revisión o reintento.

## Reglas operativas

- Xray es la única entrada productiva.
- Un lote debe agruparse por módulo y revisarse por candidate, no aprobarse a
  ciegas con `--yes`.
- El modelo no puede generar locators sin evidencia de exploración real.
- La promoción a `tests/ui` o `tests/api` exige validación E2E y revisión del
  diff por un AQA.
- Los datos de ambiente, usuarios y decisiones de negocio confirmadas se
  registran como conocimiento; nunca se guardan secretos.

## Límites conscientes

Un LLM no garantiza que una prueba sea correcta solo porque compile. Por eso el
agente usa evidencia, puertas deterministas, ejecución real y revisión humana.
La métrica clave es el porcentaje de candidates promovidos sin corrección, no el
número de archivos generados.
