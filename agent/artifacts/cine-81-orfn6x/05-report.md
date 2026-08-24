# Reporte del agente AQA - CINE-81
- **Lote Xray:** TC-001 · Verificar link “Términos y condiciones generales” con target _blank y PDF correcto
- **Proveedor de IA:** codemie (claude-4-5-sonnet)
- **Fecha:** 2026-08-24T21:47:03.454Z
## Resumen
- Test Cases importados: **1**
- Clasificacion: **1** UI, **0** API
- Pruebas ya existentes en el framework: **0**
- Cobertura: **0** cubiertos, **0** parciales, **1** faltantes
- Specs generados y validados: **1** (UI: 1, API: 0)
- Validacion E2E: **1/1** tests pasaron
- Validacion final contra el test case: **0/1** cubren todos los escenarios
- Preguntas respondidas por el QA: **5**
## Clasificacion UI / API
| Test case | Tipo | Confianza | Decidio | Justificacion |
| --- | --- | --- | --- | --- |
| CINE-81 | UI | 80% | heuristic | Vocabulario de interfaz dominante (8 senales de UI vs 0 de API). |
## Aportes del QA
| Pregunta del agente | Respuesta del QA | Afecta a |
| --- | --- | --- |
| ¿Cuál es la URL de la página representativa que tiene footer para ejecutar este test? | /mx | CINE-81 |
| ¿Cuál es la URL exacta del PDF de Términos y condiciones generales que debe abrirse? | https://pimcore-content.cinepolis.com/assets/Legales/terminos-condiciones-cinepolis.pdf pero abre como un archivo, asi que no genera una pagina nueva solo un archivo pdf | CINE-81 |
| ¿El texto exacto del enlace es 'Términos y condiciones generales' o puede tener variaciones (mayúsculas, tildes, espacios)? | TerminosTérminos y condiciones | CINE-81 |
| ¿El enlace debe tener exactamente el texto 'Términos y condiciones generales' o puede tener variaciones (mayúsculas, tildes, espacios)? | Términos y condiciones | CINE-81 |
| ¿Se debe validar que el PDF se descarga correctamente o solo que se abre en una nueva pestaña? | solo que se abra | CINE-81 |
**Cambios pedidos durante la revision**
- es Términos y condiciones
- arregla el test al hacer click en Terminos y Condiciones en el footer debe abrir una ventana nueva con el pdf
- Arregla el test, el elemento a clickear esta en el footer en legale, llamado Términos y condiciones
## Specs generados
- [OK] [UI] `tests/candidates/ui/footer-legales/cine-81-001-verificar-link-terminos-condiciones.spec.ts` - CINE-81 TC-001 · Verificar link “Términos y condiciones generales” con target _blank y PDF correcto
    - Soporte: `src/components/FooterComponent.ts`, `src/fixtures/test.ts`
    - ✓ E2E pasó (2 intento(s))
    - Análisis: El locator getByRole('link', { name: 'Términos y condiciones' }) encuentra 3 elementos en el footer que contienen ese texto: 'Términos y condiciones' (exacto), 'Términos y condiciones Cineticket' y 'Términos y Condiciones Garantía'. Playwright en strict mode requiere que los locators resuelvan a un único elemento, pero el locator actual hace match parcial con los 3 nombres accesibles. (confianza: 95%)
    - Cobertura del test case: 71% (faltan 4 escenario(s))
    - Sin cubrir: No hay expect que verifique que el footer es visible. Solo se hace scrollToFooter() pero sin aserción sobre this.footer; El código espera un evento 'download' pero no verifica que se abra una nueva pestaña. No hay page.waitForEvent('popup') ni context.waitForEvent('page'); Verificar que el footer es visible
Detalle escenario por escenario en `06-final-validation.md`.
## Siguiente paso
1. ✓ Todos los tests pasaron validación E2E - listos para usar
2. Completar los 1 spec(s) con cobertura incompleta (anotados en el encabezado del archivo).
3. Quitar el comentario de marca una vez aprobado el spec.