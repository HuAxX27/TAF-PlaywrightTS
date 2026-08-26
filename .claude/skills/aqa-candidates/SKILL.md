---
name: aqa-candidates
description: Muestra el estado auditable de todos los candidates sin razonamiento generativo innecesario.
disable-model-invocation: true
model: haiku
effort: low
allowed-tools: Bash(npm run --silent aqa:toolkit -- status) PowerShell(npm run --silent aqa:toolkit -- status)
---

Ejecuta `npm run --silent aqa:toolkit -- status`. Presenta Test Case, path, estado, E2E,
elegibilidad y motivo de bloqueo. No edites ni promociones.
