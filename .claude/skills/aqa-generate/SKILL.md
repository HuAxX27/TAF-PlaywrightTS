---
name: aqa-generate
description: Genera candidates Playwright desde Xray con especialistas y checkpoints humanos nativos.
argument-hint: <XRAY|keys:A,B|plan:KEY|jql:QUERY> [--dry-run] [--include-partial] [--yes]
disable-model-invocation: true
model: sonnet
effort: high
---

Ejecuta el pipeline AQA para `$ARGUMENTS`.

Lee primero `agent/docs/PIPELINE.md`, `CLAUDE.md` y el contrato `aqa-artifact-contract`.

- Con `--yes`, delega la corrida completa a `aqa-orchestrator`, conserva su runDir y muestra el
  resumen final. No promociones.
- Sin `--yes`, tú eres el orquestador interactivo de la sesión principal. Ejecuta la secuencia
  canónica etapa por etapa: usa los skills deterministas y delega cada decisión al agente indicado.
- Pregunta al usuario directamente por ambigüedades, clasificación de baja confianza, aprobación
  de TCs/planes, diff de cada candidate y cobertura final incompleta. No delegues esos checkpoints.
- Usa `--dry-run` para detenerte tras cobertura/planes aprobados. `--include-partial` permite
  seleccionar cobertura parcial; sin él genera solo missing.
- Escribe todos los artefactos numerados y termina con candidates, gates y bloqueos. Nunca invoques
  promoción desde el flujo de generación.
