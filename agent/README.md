# Toolkit AQA para Claude Code: Xray a Playwright

El agente AQA usa ahora la arquitectura nativa de Claude Code: slash commands basados en
skills, subagentes especializados, un orquestador batch y un CLI TypeScript sin razonamiento
generativo. Xray continúa siendo la fuente de verdad y las puertas de Playwright siguen siendo
deterministas.

## Inicio rápido

```bash
npm ci
npx playwright install --with-deps
cp .env.example .env
claude
```

Dentro de Claude Code:

```text
/aqa-generate PROJ-123
/aqa-generate keys:PROJ-123,PROJ-124
/aqa-generate plan:PROJ-PLAN-7
/aqa-generate "jql:project = CINE AND labels = regression" --dry-run
/aqa-candidates
/aqa-repair tests/candidates/ui/account/PROJ-123-profile.spec.ts
/aqa-promote all
```

Abre `claude` normalmente y usa los slash commands. El modo batch se solicita con
`/aqa-generate <selector> --yes`, que delega al `aqa-orchestrator`.

## Arquitectura

```text
/aqa-generate (sesión principal interactiva)
  -> aqa-orchestrator solo con --yes (Opus)
     -> clarifier (Sonnet)
     -> classifier (Haiku)
     -> coverage analyst (Sonnet)
     -> planner (Sonnet)
     -> codegen -> UI / API engineer (Sonnet)
     -> gates deterministas
     -> repair analyst + codegen proposal + adversarial validator, si falla
     -> final validator (Opus)
     -> learning distiller (Sonnet)
```

- **Opus** se reserva para orquestación batch y validación final.
- **Sonnet** implementa y realiza análisis semántico que necesita contexto de código.
- **Haiku** ejecuta clasificación mecánica, status y gates reproducibles.

Cada agente declara modelo, esfuerzo, herramientas, skills y máximo de turnos en
`.claude/agents/`. Los orquestadores pueden anidar especialistas hasta tres niveles y hay un
límite de seis subagentes concurrentes.

## Slash commands / skills

Claude Code unificó los custom slash commands con skills. Por eso los comandos del proyecto
viven en `.claude/skills/<command>/SKILL.md` y se invocan con `/command`:

| Comando                | Acción                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `/aqa-generate`        | Flujo principal desde Xray, con revisión y aprobación humana |
| `/aqa-repair`          | Diagnóstico y reparación con verificación independiente      |
| `/aqa-candidates`      | Estado y causa de bloqueo de candidates                      |
| `/aqa-promote`         | Promoción transaccional, siempre con confirmación            |
| `/aqa-learning-report` | Muestra conocimiento y métricas                              |
| `/aqa-help`            | Explica arquitectura y ejemplos                              |

Los skills internos `aqa-conventions`, `aqa-knowledge` y `aqa-artifact-contract` se precargan
solo donde hacen falta para no inflar el contexto principal.

## CLI determinista

`agent/toolkit-cli.ts` no llama modelos. Lo usan los agentes para operaciones que deben ser
reproducibles:

```bash
npm run aqa:toolkit -- prepare --selector=PROJ-123
npm run aqa:toolkit -- inventory
npm run aqa:toolkit -- explore --start-path=/login --triggers=login
npm run aqa:toolkit -- validate --spec=tests/candidates/ui/account/PROJ-123.spec.ts --run-dir=agent/artifacts/<run-id> --e2e
npm run aqa:toolkit -- status
npm run aqa:toolkit -- promote --all --confirm
```

El helper de promoción valida todo el lote antes de mover un archivo, corrige imports relativos,
revalida después de mover y revierte la operación si algún candidate falla.

## Flujo de calidad y humano en el ciclo

```text
Xray -> aclaraciones -> aprobación de TCs/planes -> candidate
     -> TypeScript + ESLint + Playwright --list + E2E
     -> auditoría escenario Xray vs código -> aprobación del diff
     -> ready_for_review -> /aqa-promote
```

Los subagentes no inventan decisiones del QA. Cuando requieren información o aprobación devuelven
`NEEDS_INPUT` / `NEEDS_APPROVAL`; el hilo principal pregunta y reanuda el mismo orquestador.

## Artefactos

Cada corrida crea `agent/artifacts/<run-id>/` con el contrato histórico completo:

- `00-run.json`: selector, fecha, engine y rutas.
- `01-workspace-snapshot.json`: hashes previos para probar qué archivos cambió codegen.
- `02-test-cases.*`: TCs Xray vigentes tras aclaraciones.
- `02b-kind-decisions.json`: UI/API, confianza y evidencia.
- `03-inventory.json`: pruebas existentes.
- `04-coverage.*`: trazabilidad de cobertura.
- `05-automation-plans.json`: plan previo al código.
- `05-generated.json` y `05-report.md`: candidates y resumen.
- `06-final-validation.*`: escenario Xray contra evidencia en código.
- `07-human-review.json`: preguntas, respuestas, feedback y aprobaciones.
- `08-candidate-manifest.json`: estado consumido por promoción.
- `09-learning-input.json`: evidencia redactada antes de entrar al modelo de aprendizaje.

## Seguridad

- `.claude/settings.json` bloquea lectura de `.env` y sesiones de autenticación, y nunca permite
  `git push` desde el toolkit.
- El acceso a Xray ocurre dentro del helper; sus credenciales no entran al contexto del modelo.
- El agente UI usa la skill de exploración Playwright determinista; no carga un MCP de navegador
  global ni expone sus esquemas al resto de agentes.
- Un candidate con placeholders, E2E rojo o cobertura incompleta nunca es promovible.
- La promoción requiere `--confirm` además del consentimiento en conversación.
