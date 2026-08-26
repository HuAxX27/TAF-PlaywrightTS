---
name: aqa-inventory
description: Obtiene el inventario reproducible de tests Playwright existentes con fallback seguro.
user-invocable: false
allowed-tools: Bash(npm run --silent aqa:toolkit -- inventory) PowerShell(npm run --silent aqa:toolkit -- inventory)
---

Ejecuta `npm run --silent aqa:toolkit -- inventory`. Conserva `source` y `warning`: si Playwright no puede
listar, el helper usa escaneo de specs y lo declara. Nunca interpretes un fallo como cero tests.
