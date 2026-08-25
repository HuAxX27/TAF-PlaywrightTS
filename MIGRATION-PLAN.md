# Migración del agente AQA a arquitectura Claude Code nativa (toolkit)

## Contexto

El agente actual (`agent/`) es un CLI standalone en TypeScript que convierte Test
Cases de Xray en candidates de Playwright, usando una capa de proveedores LLM
propia (`agent/llm/*`, soporta CodeMie/Gemini/Groq/OpenRouter/Ollama/mock) y un
loop de aprobación humana por readline (`framework/human.ts`).

El objetivo es migrar esto a una arquitectura nativa de Claude Code: `/`
commands, skills, subagentes independientes con modelos definidos, y un agente
orquestador. Decisiones ya tomadas:

1. **Reemplazo total**: los pasos de razonamiento pasan a ser subagentes
   nativos de Claude; se retira la capa multi-proveedor LLM. Las compuertas
   deterministas (tsc/eslint/playwright/E2E/promoción) siguen siendo
   scripts/skills invocados por Bash.
2. **Modelos por tarea**: propuestos según complejidad/costo (ver tabla).
3. **Xray/Jira**: se expone como skill que envuelve el fetch existente
   (`agent/sources/xrayTestCaseSource.ts`), no como servidor MCP nuevo.

Restricción de plataforma clave que determina el diseño del orquestador: un
subagente invocado con el Agent tool **no puede** pausar para preguntarle algo
al humano (no tiene AskUserQuestion ni chat directo). Como la revisión humana
obligatoria (test cases, código generado, cobertura final) es un requisito
explícito y reciente del proyecto (ver commit "revision humana obligatoria y
base de conocimiento"), la secuencia con checkpoints humanos debe vivir en la
sesión principal (comando slash), no dentro de un subagente en background. El
subagente orquestador dedicado se reserva para el modo no interactivo/batch
(equivalente al actual `--yes`).

Objetivo final: mismo resultado (candidates en `tests/candidates/<ui|api>/`,
promoción a `tests/`, base de conocimiento en `agent/knowledge/`), mismas
reglas de negocio (umbrales, guardrails de rutas, scrubbing de secretos,
"nunca reportar 0 tests como verdad", rollback atómico de promoción), pero
disparado por `/comandos`, ejecutado por subagentes con modelo óptimo por
tarea, con las partes deterministas en skills, y el humano interactuando
directamente en el chat en vez de un prompt readline.

## Qué se conserva tal cual (sin tocar)

Estos módulos no dependen de LLM y son la base de las skills. Se mantienen en
`agent/framework/*` y se llaman desde scripts finos vía Bash:

- `inventory.ts` — descubrimiento de tests existentes (`playwright test --list`
  + fallback regex).
- `validate.ts` — compuerta determinista (placeholders, playwright --list,
  `tsc --noEmit`, eslint).
- `explore.ts` — exploración headless de Chromium (snapshot de accesibilidad +
  heurística de clicks de trigger).
- `e2eValidation.ts` — ejecución real de Playwright, parseo de errores/JSON.
- `promotion.ts` — promoción candidate→suite con rollback atómico y auditoría.
- `shell.ts` — wrapper seguro de `execSync`.
- `fileBundle.ts` — reglas de rutas permitidas (`isAllowedSupportPath`).
- `knowledge.ts` — persistencia de la base de conocimiento + scrubbing de
  secretos (`looksLikeSecret`).
- `context.ts` — armado del contexto de framework para codegen/repair.
- `sources/xrayTestCaseSource.ts` — auth + fetch GraphQL contra Xray Cloud.

Se retiran (su lógica LLM se redistribuye en subagentes; lo no-LLM que
contengan se extrae a skills):

- `agent/llm/*` (capa multi-proveedor completa).
- `agent/pipeline.ts`, `agent/cli.ts` (el control de flujo pasa a los
  comandos slash + el subagente orquestador).
- `agent/framework/multiAgent.ts` (los 3 prompts pasan a subagentes; los
  playbooks UI/API se copian tal cual al system prompt de cada subagente).
- `agent/framework/human.ts`, `interactive.ts` (reemplazados por
  AskUserQuestion / chat nativo).
- `agent/prompts.ts` (cada plantilla se redistribuye al `.md` del subagente
  correspondiente; se conserva el texto de reglas de negocio verbatim).
- Llamada LLM dentro de `classify.ts`, `finalValidation.ts`, `learning.ts`
  (la heurística/render que no depende de LLM se conserva).

## Árbol de archivos nuevo

```
.claude/
  commands/
    aqa-generate.md        Flujo principal (interactivo, revisión humana obligatoria)
    aqa-repair.md           Repara un candidate/spec ya generado (loop E2E + multiagente)
    aqa-promote.md          Wizard de promoción de candidates listos
    aqa-candidates.md       Estado de candidates (sin LLM)
    aqa-learning-report.md  Imprime la base de conocimiento
  agents/
    aqa-orchestrator.md       opus   — corre el pipeline completo en modo batch/--yes
    aqa-clarifier.md          sonnet — detecta ambigüedades + aplica respuestas humanas a los TC
    aqa-classifier.md         haiku  — fallback LLM de clasificación UI/API (heurística ya es determinista)
    aqa-coverage-analyst.md   sonnet — TC vs inventario existente → covered/partial/missing
    aqa-planner.md            sonnet — plan de automatización auditable pre-codegen
    aqa-codegen.md            sonnet — genera/repara spec + support files (usa contexto de framework)
    aqa-repair-analyst.md     sonnet — diagnóstico de causa raíz de fallo E2E (playbooks UI/API)
    aqa-repair-validator.md   sonnet — validación adversarial de la propuesta de reparación
    aqa-final-validator.md    opus   — auditoría estricta TC original vs código generado
    aqa-learning-distiller.md sonnet — distila la sesión a reglas/recetas/hechos para knowledge base
  skills/
    aqa-fetch-xray/          Fetch de Test Cases por clave/jql/plan/keys (envuelve xrayTestCaseSource.ts)
    aqa-inventory/           Wrapper de inventory.ts
    aqa-framework-context/   Wrapper de context.ts (bundle de convenciones+fixtures+POs)
    aqa-explore-page/        Wrapper de explore.ts
    aqa-validate-spec/       Wrapper de validate.ts + chequeo de rutas permitidas (fileBundle.ts)
    aqa-e2e-run/             Wrapper de e2eValidation.ts
    aqa-promote/             Wrapper de promotion.ts
    aqa-knowledge/           Wrapper de knowledge.ts (leer/guardar/mergear base de conocimiento)
```

Cada skill = una carpeta con `SKILL.md` (cuándo usarla, contrato de
entrada/salida) + un script `tsx` fino que importa el módulo real de
`agent/framework/*` y expone una interfaz CLI (stdin/args → stdout JSON o
archivo de artefacto). Esto evita reescribir lógica ya probada.

## Modelos por subagente (propuesta y razón)

| Subagente | Modelo | Razón |
|---|---|---|
| aqa-classifier | haiku | Clasificación JSON simple, solo fallback cuando la heurística no decide; alto volumen, bajo riesgo |
| aqa-clarifier | sonnet | Detectar ambigüedad real en TCs requiere buen juicio, no es mecánico |
| aqa-coverage-analyst | sonnet | Comparar TC vs inventario existente exige entender comportamiento, no solo texto |
| aqa-planner | sonnet | Plan de automatización debe ser auditable y coherente con convenciones |
| aqa-codegen | sonnet | Generación de código es el paso de mayor volumen; sonnet ya es el estándar de código en este repo |
| aqa-repair-analyst | sonnet | Diagnóstico contra playbooks con evidencia real, tarea acotada |
| aqa-repair-validator | sonnet | Rol adversarial/escéptico sobre la propuesta de reparación |
| aqa-final-validator | opus | Última compuerta antes de promoción; el prompt actual ya exige "mejor rechazar que aprobar de más" — vale la inversión, es 1 llamada por spec |
| aqa-learning-distiller | sonnet | Debe seguir muchas reglas de exclusión (no secretos, no repetir convenciones) con fidelidad |
| aqa-orchestrator | opus | Coordina múltiples subagentes y skills en secuencia sin supervisión humana (modo batch); necesita el mejor juicio para decidir cuándo abortar/reintentar |

## Orquestación: dos caminos, misma secuencia

La secuencia de pasos (fetch → clarify → classify → inventory → coverage →
plan → codegen → validate → e2e → repair loop (máx `maxE2ERepairAttempts`) →
final-validate → knowledge distill → manifest) se documenta una sola vez en
`agent/docs/PIPELINE.md` (nueva versión condensada de las reglas de
`pipeline.ts`) para que ambos caminos no diverjan:

- **Interactivo (default, `/aqa-generate`)**: la sesión principal ejecuta la
  secuencia paso a paso. Para cada paso de razonamiento delega vía Agent tool
  al subagente correspondiente; para cada paso determinista invoca la skill
  vía Bash. En los checkpoints humanos (preguntas abiertas del TC, aprobar TC,
  aprobar código generado, aceptar/rechazar cobertura incompleta) usa
  AskUserQuestion — igual que hoy hace `framework/human.ts`, pero nativo.
- **No interactivo/batch (`--yes` o `/aqa-generate --yes`)**: delega la
  corrida completa a `aqa-orchestrator`, que ejecuta la misma secuencia sin
  pausas (usa los supuestos por defecto, igual que `nonInteractive: true` en
  el código actual), y devuelve el manifest + candidates para revisión
  posterior — la promoción sigue exigiendo un paso humano explícito
  (`/aqa-promote`), nunca automática.

El loop de reparación multiagente (`aqa-repair-analyst` → `aqa-codegen` en
modo repair → `aqa-repair-validator`) se invoca igual desde ambos caminos,
como una subrutina de 3 llamadas Agent tool en secuencia (espejo exacto de
`runMultiAgentRepair`), con el guardrail: una reparación rechazada por el
validador nunca se aplica aunque compile.

## Guardrails a preservar explícitamente

- **Rutas de soporte permitidas**: `aqa-validate-spec` extiende `validate.ts`
  para además correr `isAllowedSupportPath` (de `fileBundle.ts`) sobre los
  archivos tocados por `aqa-codegen`/`aqa-repair-*` en el diff; si algo se
  escribió fuera de `src/pages|components|api|data|fixtures/`, la skill lo
  reporta como fallo duro (hoy esto lo garantizaba el parser de bundles; al
  escribir directo con `Write` hay que verificarlo después, no antes).
- **Scrubbing de secretos**: se mantiene intacto en `knowledge.ts`; el
  subagente `aqa-learning-distiller` nunca debe recibir en su prompt datos
  que luzcan como secretos (mismo filtro `looksLikeSecret` aplicado antes de
  construir el prompt, no solo al guardar).
- **"0 tests nunca es verdad de inventario"**: se preserva en
  `aqa-inventory` (si `playwright --list` falla, la skill devuelve error
  explícito, no una lista vacía).
- **Umbral de confianza de clasificación** (`kindConfidenceThreshold`, hoy
  80): si `aqa-classifier` devuelve confianza menor, el comando pide
  confirmación humana vía AskUserQuestion en vez de asumir.
- **Promoción exige E2E aprobado + cobertura completa + revisión humana del
  diff**: `aqa-promote` skill solo lista candidates elegibles;
  `/aqa-promote` siempre muestra el diff y pide confirmación antes de mover
  archivos.
- **Rollback atómico de promoción por lote**: sin cambios, vive en
  `promotion.ts`.

## package.json / limpieza

- Se retiran los scripts `agent`, `agent:learning` (reemplazados por
  `/aqa-generate`, `/aqa-learning-report`).
- `candidates` y `promote` pueden conservarse tal cual (no dependen de LLM)
  para uso fuera de una sesión de Claude Code, además de existir como
  skills/comandos.
- `agent/llm/`, `agent/pipeline.ts`, `agent/cli.ts`,
  `agent/framework/multiAgent.ts`, `agent/framework/human.ts`,
  `agent/framework/interactive.ts`, `agent/prompts.ts` se eliminan al final,
  después de confirmar que ningún script vivo los importa.

## Plan de ejecución (una vez aprobado)

1. Crear las 8 skills (script fino + SKILL.md) reutilizando los módulos
   listados en "qué se conserva". Probar cada script de forma aislada por
   CLI antes de envolverlo en un subagente.
2. Escribir los 10 archivos `.claude/agents/*.md`, migrando el texto de
   `agent/prompts.ts` y los playbooks de `multiAgent.ts` verbatim a cada
   system prompt, con su `model:` de la tabla arriba y `tools:` acotado
   (p.ej. `aqa-classifier` no necesita `Write`).
3. Escribir `agent/docs/PIPELINE.md` (secuencia canónica) y los 5 comandos
   `.claude/commands/*.md` que la referencian.
4. Probar el flujo interactivo end-to-end contra un Test Case real de Xray
   (o el modo `mock` de datos de prueba si existe) verificando: checkpoints
   humanos, artefactos generados, validación estática, y que
   `aqa-validate-spec` rechace un archivo fuera de rutas permitidas a
   propósito.
5. Probar `/aqa-generate --yes` (camino `aqa-orchestrator`) contra el mismo
   caso y comparar el manifest con el del camino interactivo.
6. Recién entonces eliminar los módulos retirados y actualizar
   `agent/README.md`/`agent/docs/GUIA.md` para describir la nueva forma de
   uso.

## Verificación

- Cada skill se puede invocar de forma aislada por Bash y devuelve JSON
  válido / código de salida distinto de 0 en error (sin excepciones no
  capturadas).
- `npm run typecheck`, `npm run lint`, `npx playwright test --list` siguen
  funcionando igual que hoy (no se toca `playwright.config.ts` ni la
  estructura de `tests/`).
- Corrida real de `/aqa-generate` sobre un TC de Xray de prueba produce los
  mismos artefactos numerados en `agent/artifacts/<run-id>/` con contenido
  equivalente al pipeline actual, y termina en un candidate revisable en
  `tests/candidates/<ui|api>/`.
- `agent/knowledge/KNOWLEDGE.md` se actualiza tras una sesión sin incluir
  ningún dato que matchee el regex de `looksLikeSecret`.
