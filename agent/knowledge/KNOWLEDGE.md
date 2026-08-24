# Base de conocimiento del Agente AQA

> Generado automaticamente desde `knowledge-base.json`. **No edites este archivo**:
> los cambios se pierden en la siguiente corrida. Edita el `.json` y se regenera.

Actualizado: 2026-08-24T21:47:03.429Z

## Salud del aprendizaje

| Metrica                                 | Valor     |
| --------------------------------------- | --------- |
| Sesiones registradas                    | 1         |
| Specs generados                         | 3         |
| Specs que pasaron sin reparacion        | 0 (0%)    |
| Promedio de intentos de reparacion      | 1.33      |
| Preguntas evitadas por hechos conocidos | 0         |
| Reglas / Recetas / Hechos               | 3 / 1 / 4 |

Si el promedio de reparaciones no baja con las sesiones, las reglas estan mal
redactadas o no se estan respetando: revisa la columna de incumplimientos.

## Reglas

### Tests de UI

| ID    | Regla                                                                                                                                                                 | Cuando aplica                                                                                           | Origen     | Confirmada | Incumplida despues |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------- | ---------- | ------------------ |
| R-001 | Usa toHaveAttribute(atributo, valor) en lugar de getAttribute() + expect().toBe() para verificar atributos HTML                                                       | Error de ESLint 'playwright/prefer-web-first-assertions' al usar getAttribute() seguido de expect       | reparacion | 1x         | 0x                 |
| R-002 | Cuando un enlace con target='_blank' descarga un archivo PDF directamente (no abre pestaña), usa page.waitForEvent('download') en lugar de page.waitForEvent('popup') | El test case indica que se abre PDF en nueva pestaña pero el comportamiento real es descarga de archivo | QA         | 1x         | 0x                 |
| R-003 | Verifica visibilidad del contenedor padre (footer, header, modal) antes de interactuar con elementos hijos dentro de él                                               | coverageGaps reporta 'No hay expect que verifique que el footer es visible'                             | cobertura  | 1x         | 0x                 |

## Soluciones verificadas

### C-001 - Verificar que un enlace descarga un PDF con URL específica cuando tiene target='_blank'

- **Aplica a:** Tests de UI
- **Va en:** `tests/spec`
- **Confirmada:** 1x

```typescript
const downloadPromise = page.waitForEvent("download");
const link = await component.getLink();
await link.click();
const download = await downloadPromise;
const downloadUrl = download.url();
expect(downloadUrl).toContain(".pdf");
expect(downloadUrl).toBe("https://expected-url.com/file.pdf");
```

## Hechos del dominio

Datos que el agente no puede deducir del codigo. Cada uno evita una pregunta al QA
en las siguientes corridas.

| Area           | Pregunta que responde                                                                        | Dato                                                                                    | Origen |
| -------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| footer-legales | ¿Cuál es la URL de la página representativa que tiene footer para ejecutar tests del footer? | /mx                                                                                     | QA     |
| footer-legales | ¿Cuál es la URL exacta del PDF de Términos y condiciones generales?                          | https://pimcore-content.cinepolis.com/assets/Legales/terminos-condiciones-cinepolis.pdf | QA     |
| footer-legales | ¿Cuál es el texto exacto del enlace de Términos y condiciones en el footer?                  | Términos y condiciones                                                                  | QA     |
| footer-legales | ¿El enlace de Términos y condiciones descarga el PDF o abre una nueva pestaña?               | Descarga el archivo PDF directamente, no genera una página nueva                        | QA     |

## Historial de sesiones

| Fecha      | Sesion  | Specs | Sin reparar | Nuevas reglas | Recetas | Hechos |
| ---------- | ------- | ----- | ----------- | ------------- | ------- | ------ |
| 2026-08-24 | CINE-81 | 3     | 0           | 3             | 1       | 4      |

## Como mantener esta base

- **Borrar una leccion mala:** quita su entrada del `.json` y commitea.
- **Corregir la redaccion:** editala en el `.json`; se conserva su historial.
- **Agregar conocimiento a mano:** copia una entrada existente, ponle un id nuevo
  y `"origin": "seed"` (reglas) o `"source": "human"` (hechos).
- **Reglas con muchos incumplimientos:** senal de que estan ambiguas. Reescribelas
  en imperativo y con un trigger concreto.
- **Nunca** guardes contrasenas, tokens ni secretos aqui: este archivo va al repo.
