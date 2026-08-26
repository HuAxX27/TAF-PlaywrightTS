---
name: aqa-repair
description: Repara un candidate mediante diagnóstico, propuesta, revisión adversarial y revalidación E2E.
argument-hint: <tests/candidates/...spec.ts>
disable-model-invocation: true
model: sonnet
effort: high
---

Repara `$ARGUMENTS` desde la sesión principal siguiendo la subrutina de
`agent/docs/PIPELINE.md`:

1. Crea un runDir de reparación y ejecuta `aqa:toolkit snapshot` antes de cualquier edición.
2. Ejecuta `aqa-validate-spec` y `aqa-e2e-run` para reproducir.
3. Delega causa raíz a `aqa-repair-analyst`.
4. Si requiere dato humano, pregunta aquí y no supongas.
5. Pide a `aqa-codegen` una propuesta en modo repair sin aplicarla.
6. Pasa propuesta, diagnóstico, TC y evidencia a `aqa-repair-validator`. Aplica solo si aprueba.
7. Revalida static+E2E y audita con `aqa-final-validator`. Máximo tres ciclos.
8. Muestra diff y pide aprobación antes de marcar `ready_for_review`. Actualiza artefactos/manifest.

No promociones y no debilites aserciones/locators para forzar verde.
