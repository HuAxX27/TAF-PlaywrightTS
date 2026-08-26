---
name: aqa-artifact-contract
description: Contrato de artefactos, estados y puertas de calidad para corridas AQA orquestadas por Claude.
user-invocable: false
---

Cada corrida usa el `artifactsDir` devuelto por `aqa:toolkit prepare` y mantiene estos archivos:

| Archivo                        | Responsable           | Contenido                                          |
| ------------------------------ | --------------------- | -------------------------------------------------- |
| `00-run.json`                  | helper                | selector, fecha, engine y rutas                    |
| `01-workspace-snapshot.json`   | helper                | hashes previos para verificar archivos tocados     |
| `02-test-cases.json/.md`       | helper + requirements | TCs vigentes tras aclaraciones                     |
| `02b-kind-decisions.json`      | classifier            | `{testCaseId,kind,confidence,rationale,decidedBy}` |
| `03-inventory.json`            | helper                | inventario Playwright existente                    |
| `04-coverage.json/.md`         | coverage              | covered/partial/missing con evidencia              |
| `05-automation-plans.json`     | planner               | plan por TC antes de escribir código               |
| `05-generated.json`            | orchestrator          | paths y resultados de validación por candidate     |
| `05-report.md`                 | orchestrator          | resumen auditable de la corrida                    |
| `06-final-validation.json/.md` | final auditor         | escenario del TC contra evidencia en código        |
| `07-human-review.json`         | orchestrator          | preguntas, respuestas, feedback y aprobaciones     |
| `08-candidate-manifest.json`   | orchestrator          | estado consumido por promoción                     |
| `09-learning-input.json`       | helper                | evidencia sanitizada antes de entrar al modelo     |

Un elemento de `08-candidate-manifest.json` tiene:

```json
{
    "testCaseId": "PROJ-123",
    "kind": "ui",
    "candidate": "tests/candidates/ui/modulo/PROJ-123-name.spec.ts",
    "status": "ready_for_review",
    "supportFiles": ["src/pages/ExamplePage.ts"],
    "e2ePassed": true
}
```

Estados permitidos:

- `ready_for_review`: estático OK, E2E OK y cobertura final completa.
- `needs_repair`: cualquier validación técnica falla.
- `coverage_incomplete`: el código funciona pero omite o debilita un escenario Xray.

Escritura de código permitida: `tests/candidates/**` y soporte bajo `src/pages`,
`src/components`, `src/api`, `src/data`, `src/fixtures`. Nunca marques listo sin evidencia. JSON
debe ser válido, UTF-8 y estable; Markdown debe enlazar los paths relevantes.
