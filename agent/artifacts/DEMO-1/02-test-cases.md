# Test Cases - DEMO-1

**Historia:** Documentos legales accesibles desde el footer


## Criterios de aceptacion analizados

1. La seccion "Legales" del footer muestra el enlace de Terminos y condiciones generales apuntando al PDF correcto y con target _blank
2. El enlace de Terminos y condiciones Cineticket abre el PDF correspondiente en una pestana nueva y responde con HTTP 200
3. El enlace de Aviso de privacidad abre el PDF correspondiente en una pestana nueva
4. El enlace de Terminos Cinecash esta visible en el footer y abre su PDF en una pestana nueva
5. El enlace de Terminos y Condiciones Garantia Cinepolis abre su PDF y el content-type de la respuesta es application/pdf
6. El enlace de Formato de reclamo Garantia Cinepolis esta visible y descarga el formato correcto
7. La seccion Legales del footer es visible en viewport movil

## Test cases propuestos

### TC-01 - La seccion "Legales" del footer muestra el enlace de Terminos y condiciones generales apuntando al PDF correcto y con target _blank

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** critical
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: La seccion "Legales" del footer muestra el enlace de Terminos y condiciones generales apuntando al PDF correcto y con target _blank

**Resultado esperado:** La seccion "Legales" del footer muestra el enlace de Terminos y condiciones generales apuntando al PDF correcto y con target _blank

### TC-02 - El enlace de Terminos y condiciones Cineticket abre el PDF correspondiente en una pestana nueva y responde con HTTP 200

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** high
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: El enlace de Terminos y condiciones Cineticket abre el PDF correspondiente en una pestana nueva y responde con HTTP 200

**Resultado esperado:** El enlace de Terminos y condiciones Cineticket abre el PDF correspondiente en una pestana nueva y responde con HTTP 200

### TC-03 - El enlace de Aviso de privacidad abre el PDF correspondiente en una pestana nueva

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** high
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: El enlace de Aviso de privacidad abre el PDF correspondiente en una pestana nueva

**Resultado esperado:** El enlace de Aviso de privacidad abre el PDF correspondiente en una pestana nueva

### TC-04 - El enlace de Terminos Cinecash esta visible en el footer y abre su PDF en una pestana nueva

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** high
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: El enlace de Terminos Cinecash esta visible en el footer y abre su PDF en una pestana nueva

**Resultado esperado:** El enlace de Terminos Cinecash esta visible en el footer y abre su PDF en una pestana nueva

### TC-05 - El enlace de Terminos y Condiciones Garantia Cinepolis abre su PDF y el content-type de la respuesta es application/pdf

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** high
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: El enlace de Terminos y Condiciones Garantia Cinepolis abre su PDF y el content-type de la respuesta es application/pdf

**Resultado esperado:** El enlace de Terminos y Condiciones Garantia Cinepolis abre su PDF y el content-type de la respuesta es application/pdf

### TC-06 - El enlace de Formato de reclamo Garantia Cinepolis esta visible y descarga el formato correcto

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** high
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: El enlace de Formato de reclamo Garantia Cinepolis esta visible y descarga el formato correcto

**Resultado esperado:** El enlace de Formato de reclamo Garantia Cinepolis esta visible y descarga el formato correcto

### TC-07 - La seccion Legales del footer es visible en viewport movil

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** high
- **Tags:** @regression @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: La seccion Legales del footer es visible en viewport movil

**Resultado esperado:** La seccion Legales del footer es visible en viewport movil

### TC-08 - Comportamiento ante datos invalidos o estado inesperado

- **Tipo:** UI
- **Nivel:** e2e
- **Prioridad:** medium
- **Tags:** @regression @negative @ui
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Forzar el escenario negativo descrito en la historia

**Resultado esperado:** La aplicacion muestra un mensaje de error controlado
