# Pipeline canónico del toolkit AQA

Esta es la única secuencia autorizada para `/aqa-generate` y el agente batch
`aqa-orchestrator`.

## Secuencia

1. **Prepare:** `aqa:toolkit prepare` crea runDir, toma una instantánea hash del workspace,
   importa Xray y toma inventario.
2. **Clarify:** `aqa-clarifier` detecta preguntas. En interactivo la sesión principal pregunta,
   aplica respuestas y solicita aprobación de los TCs refinados. En `--yes` conserva supuestos
   explícitos y los registra; no inventa datos imprescindibles.
3. **Classify:** `aqa:toolkit classify` resuelve señales duras. Solo los ambiguos pasan a
   `aqa-classifier`. Confianza menor que `KIND_CONFIDENCE_THRESHOLD` (80 por defecto) se confirma
   con el humano en modo interactivo.
4. **Coverage:** `aqa-coverage-analyst` compara TC contra inventario y código real. Un fallo de
   inventario nunca se convierte en lista vacía silenciosa.
5. **Plan:** `aqa-planner` mapea pasos/resultados a capas, datos, exploración y aserciones. La
   sesión principal pide aprobación antes de escribir código.
6. **Codegen:** `aqa-codegen` usa contexto UI/API, exploración real y rutas permitidas. Escribe
   primero en `tests/candidates/<ui|api>/<module>/`.
7. **Static gate:** `aqa-validate-spec` compara el workspace contra la instantánea, comprueba que
   solo se tocaron candidate y soporte declarado, rutas, placeholders, Playwright list, TypeScript
   y ESLint. El humano revisa el diff de cada candidate en modo interactivo.
8. **E2E gate:** `aqa-e2e-run` ejecuta Chromium. Si falla: `aqa-repair-analyst` diagnostica,
   `aqa-codegen` propone/repara, `aqa-repair-validator` revisa adversarialmente y solo entonces se
   aplica/revalida. Máximo `MAX_E2E_REPAIR_ATTEMPTS` (3 por defecto).
9. **Final gate:** `aqa-final-validator` (Opus) compara cada escenario Xray contra evidencia en el
   candidate y soporte. Funcionar no implica cubrir. Cobertura incompleta nunca queda ready.
10. **Learning:** el helper genera `09-learning-input.json` sanitizado antes de invocar al modelo;
    `aqa-learning-distiller` produce reglas/recetas/hechos desde esa entrada y `aqa-knowledge`
    vuelve a filtrar, deduplica y guarda solo evidencia confirmada.
11. **Manifest/report:** se escriben todos los artefactos del contrato. La generación termina en
    `ready_for_review`, `needs_repair` o `coverage_incomplete`; jamás promueve.

## Caminos

- **Interactivo (default):** el command corre en la sesión principal y delega etapa por etapa.
  AskUserQuestion/chat se usa para preguntas y aprobaciones; un subagente no finge interacción.
- **Batch (`--yes`):** la sesión principal delega la secuencia completa a `aqa-orchestrator`.
  Sigue siendo conservador: un requisito esencial ausente bloquea. La promoción continúa siendo
  humana y separada.

## Guardrails

- Xray es la fuente de verdad; no se crean tests desde User Stories.
- Soporte editable: `src/pages|components|api|data|fixtures/**.ts` únicamente.
- Prohibidos `TODO`, `PENDIENTE`, `test.fixme`, `waitForTimeout` y secretos.
- UI requiere DOM/ARIA observado; API requiere método/ruta/contrato evidenciado.
- Promoción exige static OK, E2E true, cobertura 100%, revisión de diff y confirmación explícita.
- `promotion.ts` realiza preflight y rollback atómico del lote.
