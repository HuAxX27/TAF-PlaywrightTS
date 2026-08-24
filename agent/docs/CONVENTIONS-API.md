# Convenciones para tests API

## Arquitectura

- Un test API no usa `page`, navegador, Page Objects ni locators.
- `ApiClient` administra el `APIRequestContext` y la configuración HTTP común.
- Cada recurso de negocio vive en una clase tipada de `src/api/services/`.
- El spec prepara datos, invoca el service y verifica el contrato observable.
- Registra cada service requerido como fixture tipado en `src/fixtures/test.ts`.

## Contratos HTTP

- Declara interfaces separadas para request y response; no uses `any`.
- Verifica explícitamente status code, headers relevantes y campos del body exigidos por el TC.
- Para escenarios negativos usa los métodos `*Raw` de `ApiClient`, afirma status/content-type y
  después parsea el body cuando corresponda.
- No conviertas una aserción exacta de negocio en rangos genéricos para hacer pasar el test.
- Las rutas de servicios son relativas a `BASE_URL`; una URL absoluta sólo es válida si el TC la
  identifica como servicio externo.

## Datos y limpieza

- Genera datos únicos mediante factories de `src/data/` cuando el TC no imponga valores concretos.
- Nunca hardcodees credenciales, tokens o identificadores compartidos.
- Cada test crea y elimina sus propios recursos cuando sea posible.
- La limpieza debe ejecutarse aunque una aserción intermedia falle, sin ocultar el fallo original.

## Independencia

Los tests deben pasar de forma aislada, en lote, en cualquier orden y con workers paralelos. No
reutilices estado mutable entre specs ni dependas de recursos creados por otra prueba.
