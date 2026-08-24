# Validacion final: test case original vs codigo generado



## CINE-81 - TC-001 · Verificar link “Términos y condiciones generales” con target _blank y PDF correcto
- **Tipo:** UI
- **Cobertura del test case:** 71%
- **Cubre todos los escenarios:** NO
- **Aprobado por el humano:** si
**Veredicto:** El código cubre 5 de 7 escenarios. Falta verificar que el footer es visible y que se abre una nueva pestaña. Además, el enfoque de 'download' puede no ser correcto si el PDF se abre en pestaña nueva en lugar de descargarse.
| Escenario del test case | Estado | Evidencia en el codigo | Brecha |
| --- | --- | --- | --- |
| Abrir una página del sitio que tenga footer | Cubierto | await page.goto("/mx", { waitUntil: "domcontentloaded" }); await expect(page).toHaveURL(/\/mx/); | - |
| Se visualiza el footer | Falta | - | No hay expect que verifique que el footer es visible. Solo se hace scrollToFooter() pero sin aserción sobre this.footer |
| La sección 'Legales' es visible | Cubierto | await expect(footerComponent.legalesSection).toBeVisible(); | - |
| El elemento tiene target="_blank" | Cubierto | await expect(terminosLink).toHaveAttribute("target", "_blank"); | - |
| Se abre una nueva pestaña | Falta | - | El código espera un evento 'download' pero no verifica que se abra una nueva pestaña. No hay page.waitForEvent('popup') ni context.waitForEvent('page') |
| La URL termina en .pdf | Cubierto | expect(downloadUrl).toContain(".pdf"); | - |
| La URL coincide con la URL esperada | Cubierto | expect(downloadUrl).toBe("https://pimcore-content.cinepolis.com/assets/Legales/terminos-condiciones-cinepolis.pdf"); | - |
**Escenarios sin cubrir**
- No hay expect que verifique que el footer es visible. Solo se hace scrollToFooter() pero sin aserción sobre this.footer
- El código espera un evento 'download' pero no verifica que se abra una nueva pestaña. No hay page.waitForEvent('popup') ni context.waitForEvent('page')
- Verificar que el footer es visible
- Verificar que se abre una nueva pestaña (popup/tab)
**Comportamientos que el codigo valida y el test case no pedia**
- Valida que el enlace 'Términos y condiciones' es visible (no pedido explícitamente en expectedResult)
- Maneja el comportamiento como descarga (download event) en lugar de nueva pestaña, lo cual puede no coincidir con el comportamiento real del navegador para PDFs con target=_blank

