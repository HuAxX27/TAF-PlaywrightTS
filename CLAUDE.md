# TAF Playwright: toolkit AQA

Este repositorio usa Claude Code como capa de razonamiento del agente AQA. El código en
`agent/toolkit-cli.ts` conserva únicamente operaciones deterministas: importar Xray,
inventariar, explorar, validar, listar, aprender y promover. No existe una ruta alternativa con
proveedores de modelos dentro del proyecto.

## Enrutamiento

- Generación interactiva desde Xray: `/aqa-generate <selector>`.
- Diagnóstico y reparación: `/aqa-repair <candidate>`.
- Estado: `/aqa-candidates`.
- Promoción: `/aqa-promote <candidate|all>`.
- Reporte de aprendizaje: `/aqa-learning-report`; la destilación segura forma parte del pipeline.
- Explicación de arquitectura: `/aqa-help`.

Para trabajos AQA delega en los agentes de `.claude/agents/`; no simules varios roles en un
solo contexto. La sesión principal orquesta el camino interactivo; `aqa-orchestrator` coordina el
batch `--yes`. Los especialistas entregan resultados estructurados.

## Invariantes de seguridad y calidad

- Xray es la fuente de verdad. No inventes requisitos, endpoints, datos, credenciales ni
  locators. Cuando falte una decisión de negocio, detente y pregunta.
- Nunca leas ni muestres `.env`, sesiones de autenticación o secretos. Los helpers consumen
  las variables internamente.
- El código nuevo vive primero en `tests/candidates/<ui|api>/<modulo>/`.
- Los archivos de soporte solo pueden tocarse bajo `src/pages`, `src/components`, `src/api`,
  `src/data` y `src/fixtures`. Conserva cambios ajenos.
- Un candidate no está listo si contiene `TODO`, `PENDIENTE`, `test.fixme` o
  `waitForTimeout`, si falla TypeScript/ESLint/Playwright, si no pasa E2E o si no cubre el TC.
- La promoción requiere revisión humana explícita del reporte y del diff. Nunca promociones
  automáticamente como parte de `/aqa-generate` o `/aqa-repair`.
- Antes de codegen crea `01-workspace-snapshot.json`; toda validación recibe el runDir y rechaza
  cambios fuera del candidate y soporte declarado.
- Antes de aprendizaje ejecuta `knowledge-sanitize`; el destilador solo recibe
  `09-learning-input.json`, nunca los artefactos crudos.
- Registra los artefactos en `agent/artifacts/<run-id>/` según el contrato del skill
  `aqa-artifact-contract`.

## Convenciones del framework

Lee `agent/docs/CONVENTIONS.md` y, según el tipo, `CONVENTIONS-UI.md` o
`CONVENTIONS-API.md`. Los specs importan `{ test, expect }` desde `src/fixtures/test`, usan
`test.step` en español y no declaran locators.
