---
name: aqa-validate-spec
description: Valida candidate y soporte con rutas permitidas, placeholders, Playwright list, TypeScript y ESLint.
user-invocable: false
allowed-tools: Bash(npm run --silent aqa:toolkit -- validate *) PowerShell(npm run --silent aqa:toolkit -- validate *)
---

Ejecuta `npm run --silent aqa:toolkit -- validate --spec=<candidate> --support=<csv>
--run-dir=<artifact-dir>`. El runDir debe contener `01-workspace-snapshot.json`, creado por
`prepare` o `snapshot` antes de codegen.

El helper calcula hashes del workspace y rechaza cualquier archivo cambiado que no sea el spec
declarado o un soporte permitido bajo `src/pages`, `src/components`, `src/api`, `src/data` o
`src/fixtures`. No confíes en una lista de paths producida por el agente. Un exit code distinto de
cero es gate fallido.
