# Convenciones del TAF

Estas reglas son el contrato que debe respetar todo código generado desde Test Cases de Xray.
El repositorio parte de una base neutral: no asumas páginas, servicios, usuarios ni reglas de
negocio que no existan todavía en el código o en el TC.

## Estructura

- `tests/candidates/<ui|api>/<modulo>/`: specs generados, todavía fuera de regresión.
- `tests/<ui|api>/<modulo>/`: specs revisados y promovidos.
- `src/pages/`: Page Objects de una página o flujo de UI.
- `src/components/`: componentes reutilizables entre páginas.
- `src/api/services/`: servicios HTTP agrupados por recurso.
- `src/data/`: factories de datos de prueba.
- `src/fixtures/test.ts`: única entrada de fixtures para los specs.
- `src/config/`: configuración de ambiente, nunca secretos hardcodeados.

## Reglas obligatorias

- El título conserva la clave Xray y describe comportamiento observable.
- El spec importa `{ test, expect }` desde el fixture relativo del framework.
- Cada acción de negocio se expresa con `test.step` en el mismo orden del TC.
- Cada resultado esperado tiene una aserción explícita; ejecutar una acción no demuestra éxito.
- Los tests son independientes, repetibles y seguros para ejecución paralela.
- No uses `test.only`, `test.skip`, `test.fixme`, `TODO`, `PENDIENTE` ni `waitForTimeout`.
- No ocultes fallos con `try/catch`, aserciones débiles o timeouts mayores.
- No escribas secretos, tokens, contraseñas ni datos personales en código o artefactos.
- Reutiliza código existente solamente cuando su contrato coincide con el TC.
- Crea la mínima cantidad de archivos necesaria y evita utilidades abstractas para un solo uso.

## Evidencia y trazabilidad

El Test Case de Xray es la fuente de verdad funcional. El código existente demuestra cómo está
construido el TAF. La exploración y la ejecución real demuestran cómo se comporta la aplicación.
Si estas fuentes se contradicen, no inventes una solución: reporta el riesgo para revisión humana.

El candidate debe poder relacionar cada paso y resultado del TC con una sección concreta del spec.
Una prueba que compila pero no valida el resultado esperado se considera incompleta.
