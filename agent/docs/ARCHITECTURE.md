# Arquitectura del toolkit AQA

Claude Code contiene la capa de razonamiento. TypeScript conserva únicamente operaciones
deterministas y auditables.

```text
/aqa-* (skill pública y sesión principal)
  -> agente especializado Haiku / Sonnet / Opus
     -> worker UI o API cuando hay escritura
  -> skill operativa
     -> agent/toolkit-cli.ts
        -> Xray, filesystem, TypeScript, ESLint y Playwright
```

## Orquestación

- El flujo interactivo vive en la sesión principal para poder preguntar y solicitar aprobaciones.
- `/aqa-generate --yes` delega el pipeline completo a `aqa-orchestrator`.
- Haiku clasifica; Sonnet analiza, planifica, implementa y repara; Opus orquesta batch y realiza la
  auditoría final.
- La reparación siempre sigue analista → propuesta → revisión adversarial → aplicación → gates.
- La promoción es un workflow separado y nunca ocurre automáticamente.

## Frontera determinista

Las skills operativas comparten `agent/toolkit-cli.ts`. Sus subcomandos producen JSON y reutilizan
los módulos bajo `agent/framework/` y `agent/sources/`; ninguno llama modelos ni proveedores
externos de IA.

Los gates de TypeScript, ESLint, `playwright --list`, E2E, rutas permitidas y promoción
transaccional son resultados del CLI, no opiniones de un agente.

## Guardrails

- `01-workspace-snapshot.json` registra SHA-256 antes de codegen. `validate --run-dir` falla si se
  modifica cualquier ruta fuera de candidates o soporte permitido.
- `09-learning-input.json` es la única evidencia de corrida que puede recibir el destilador; se
  sanitiza antes de entrar al modelo y se vuelve a comprobar antes del merge.
- Los artefactos se comparten por path entre agentes para evitar duplicar logs y contexto.
- La promoción exige manifest elegible, E2E aprobado, cobertura completa, revisión humana y
  `--confirm`; el lote tiene preflight y rollback.
