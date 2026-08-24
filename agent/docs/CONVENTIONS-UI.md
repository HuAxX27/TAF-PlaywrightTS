# Convenciones para tests UI

## Separación de responsabilidades

- El spec describe el escenario, pasos y aserciones; no contiene locators.
- Un Page Object representa una página o flujo y encapsula navegación y acciones.
- Un Component encapsula una pieza reutilizable presente en más de una página.
- Cada Page Object requerido por un spec se registra como fixture tipado en
  `src/fixtures/test.ts`.

## Locators basados en evidencia

Usa esta prioridad:

1. rol y nombre accesible confirmados por la exploración;
2. label, placeholder o texto estable confirmado;
3. `data-testid` cuando exista y sea parte del contrato;
4. CSS únicamente cuando no haya una semántica estable y la exploración lo confirme.

No inventes ids, textos, rutas ni estados. Evita `nth()`, clases generadas, selectores DOM largos y
`exact: true` sin necesidad. Resuelve strict-mode violations haciendo el locator semánticamente
único, no seleccionando el primer elemento arbitrariamente.

## Navegación y sincronización

- Navega con rutas relativas a `BASE_URL`.
- Usa `domcontentloaded`, `waitForURL`, aserciones web-first y auto-waiting.
- Maneja modales, banners o carga diferida sólo cuando el TC, la exploración o una ejecución fallida
  demuestre que existen.
- Un helper opcional debe ser idempotente y no puede ocultar errores de la funcionalidad probada.

## Aserciones

- Verifica el estado final observable indicado en `expectedResult`.
- Para navegación, afirma URL y contenido distintivo cuando ambos formen parte del resultado.
- Para descargas, pestañas o respuestas de red, espera el evento antes de ejecutar la acción.
- No uses únicamente `toBeTruthy`, existencia del objeto Page o ausencia de excepciones.

## Datos y aislamiento

Prepara por test los datos que cambian. No dependas del orden de ejecución ni de datos creados por
otro spec. Si el escenario modifica estado persistente, restaúralo o elimínalo de forma segura.
