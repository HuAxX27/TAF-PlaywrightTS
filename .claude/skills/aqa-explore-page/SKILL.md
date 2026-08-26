---
name: aqa-explore-page
description: Explora una ruta real en Chromium y devuelve URL, título y snapshot accesible para evitar locators inventados.
user-invocable: false
allowed-tools: Bash(npm run --silent aqa:toolkit -- explore *) PowerShell(npm run --silent aqa:toolkit -- explore *)
---

Ejecuta `npm run --silent aqa:toolkit -- explore --start-path=<ruta> [--triggers=a,b]`. Triggers son textos
accesibles literales. Un warning o snapshot vacío es falta de evidencia y bloquea locators nuevos.
