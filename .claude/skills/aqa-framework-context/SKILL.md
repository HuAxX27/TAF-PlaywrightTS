---
name: aqa-framework-context
description: Construye contexto acotado de convenciones, fixtures, capas y conocimiento para codegen o reparación UI/API.
user-invocable: false
allowed-tools: Bash(npm run --silent aqa:toolkit -- context *) PowerShell(npm run --silent aqa:toolkit -- context *)
---

Ejecuta `npm run --silent aqa:toolkit -- context --kind=<ui|api>`. Usa solo la rama relevante: UI incluye
Pages/Components; API incluye cliente/services/config. El resultado ya aplica presupuesto de
contexto y conocimiento. Verifica en disco cualquier detalle crítico antes de editar.
