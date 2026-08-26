---
name: aqa-knowledge
description: Conocimiento acumulado del agente AQA y reglas para reutilizarlo sin convertir inferencias en hechos.
user-invocable: false
---

Consulta `agent/knowledge/KNOWLEDGE.md` y, si necesitas estructura o procedencia,
`agent/knowledge/knowledge-base.json`.

- Una respuesta humana confirmada puede reutilizarse si el entorno y área coinciden.
- Una receta es orientación, no evidencia del DOM ni de un endpoint actual.
- Si Xray o la aplicación contradicen el conocimiento, prevalece la evidencia actual y registra
  la obsolescencia para el curador.
- Nunca copies secretos ni datos personales a artefactos o memoria.

Operaciones deterministas:

- Reporte: `npm run --silent aqa:toolkit -- knowledge-report`.
- Entrada segura para el destilador: `npm run --silent aqa:toolkit -- knowledge-sanitize
--run-dir=<artifact-dir>`. El helper selecciona artefactos JSON, redacta secretos/PII y escribe
  `09-learning-input.json`. El modelo solo puede recibir ese archivo, nunca el runDir crudo.
- Merge de una destilación JSON ya revisada: `npm run --silent aqa:toolkit -- knowledge-merge
--input=<artifact.json> --session=<run-id>`. El helper rechaza el lote completo si detecta texto
  con apariencia de secreto, limita el crecimiento por sesión, actualiza métricas de forma
  idempotente y regenera JSON+Markdown de manera consistente.
