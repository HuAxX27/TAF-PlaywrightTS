---
name: aqa-conventions
description: Convenciones obligatorias para diseñar, generar, revisar o reparar tests Playwright de este repositorio.
user-invocable: false
---

Antes de trabajar con un test lee:

- siempre `agent/docs/CONVENTIONS.md`;
- para UI `agent/docs/CONVENTIONS-UI.md`;
- para API `agent/docs/CONVENTIONS-API.md`.

Reglas no negociables:

- Xray define el comportamiento esperado; una falta de información se pregunta.
- Specs desde `src/fixtures/test`, `test.step` en español y tags en metadata.
- UI: locators por rol/texto en Page Objects o Components, nunca en specs.
- API: transporte en services, payloads en factories y aserciones de status/body explícitas.
- Sin `waitForTimeout`, `TODO`, `PENDIENTE`, `test.fixme` ni secretos.
- Reutiliza capas existentes antes de crear archivos y toca el mínimo necesario.
