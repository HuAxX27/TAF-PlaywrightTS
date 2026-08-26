---
name: aqa-fetch-xray
description: Importa Test Cases reales desde Xray por clave, keys, Test Plan o JQL sin exponer credenciales.
user-invocable: false
allowed-tools: Bash(npm run --silent aqa:toolkit -- fetch *) PowerShell(npm run --silent aqa:toolkit -- fetch *)
---

Ejecuta `npm run --silent aqa:toolkit -- fetch --selector="<selector>"`. Selectores: `PROJ-1`,
`keys:PROJ-1,PROJ-2`, `plan:PROJ-PLAN-1`, `jql:<consulta>`. Devuelve JSON con `selector` y
`testCases`. No leas `.env`; el helper autentica y nunca imprime sus credenciales.
