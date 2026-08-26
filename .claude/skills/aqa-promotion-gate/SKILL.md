---
name: aqa-promotion-gate
description: Lista o promueve candidates mediante la compuerta transaccional, con confirmación obligatoria.
user-invocable: false
---

- Listar: `npm run --silent aqa:toolkit -- status`.
- Promover tras confirmación humana: `npm run --silent aqa:toolkit -- promote --paths=<csv> --confirm` o
  `--all --confirm`.

No invoques promoción desde generate/repair. El helper exige manifest `ready_for_review`, E2E true,
validación vigente y hace rollback de lote ante fallo.
