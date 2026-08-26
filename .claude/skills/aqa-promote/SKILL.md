---
name: aqa-promote
description: Promueve candidates elegibles con revisión de reportes, diff y confirmación humana.
argument-hint: <candidate[,candidate...]|all>
disable-model-invocation: true
model: sonnet
effort: low
---

Usa `aqa-promotion-gate` para listar candidates. Para `$ARGUMENTS`:

1. Verifica `ready_for_review`, E2E true y manifest vigente.
2. Muestra `05-report.md`, `06-final-validation.md` y el diff relevante.
3. Pide confirmación explícita en este chat.
4. Solo entonces ejecuta una única promoción con `--confirm`.
5. Reporta destinos y auditoría. Si el helper falla, informa que el lote fue revertido.
