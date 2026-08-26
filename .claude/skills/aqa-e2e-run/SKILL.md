---
name: aqa-e2e-run
description: Ejecuta un candidate en Chromium y devuelve errores parseados, screenshots, trazas y output compacto.
user-invocable: false
allowed-tools: Bash(npm run --silent aqa:toolkit -- e2e *) PowerShell(npm run --silent aqa:toolkit -- e2e *)
---

Ejecuta `npm run --silent aqa:toolkit -- e2e --spec=<candidate> [--test-name=<titulo>]`. No edites código
durante esta skill. Devuelve paths de evidencia al analista y conserva el código de salida.
