# Base de conocimiento del Agente AQA

> Generado automaticamente desde `knowledge-base.json`. **No edites este archivo**:
> los cambios se pierden en la siguiente corrida. Edita el `.json` y se regenera.

Actualizado: 2026-08-24T17:25:04.767Z

## Salud del aprendizaje

| Metrica | Valor |
| --- | --- |
| Sesiones registradas | 0 |
| Specs generados | 22 |
| Specs que pasaron sin reparacion | 22 (100%) |
| Promedio de intentos de reparacion | 1 |
| Preguntas evitadas por hechos conocidos | 0 |
| Reglas / Recetas / Hechos | 0 / 0 / 0 |

Si el promedio de reparaciones no baja con las sesiones, las reglas estan mal
redactadas o no se estan respetando: revisa la columna de incumplimientos.

## Reglas

_Todavia no hay reglas aprendidas._

## Soluciones verificadas

_Todavia no hay soluciones registradas._

## Hechos del dominio

Datos que el agente no puede deducir del codigo. Cada uno evita una pregunta al QA
en las siguientes corridas.

_Todavia no hay hechos registrados._

## Historial de sesiones

_Sin sesiones registradas._

## Como mantener esta base

- **Borrar una leccion mala:** quita su entrada del `.json` y commitea.
- **Corregir la redaccion:** editala en el `.json`; se conserva su historial.
- **Agregar conocimiento a mano:** copia una entrada existente, ponle un id nuevo
  y `"origin": "seed"` (reglas) o `"source": "human"` (hechos).
- **Reglas con muchos incumplimientos:** senal de que estan ambiguas. Reescribelas
  en imperativo y con un trigger concreto.
- **Nunca** guardes contrasenas, tokens ni secretos aqui: este archivo va al repo.
