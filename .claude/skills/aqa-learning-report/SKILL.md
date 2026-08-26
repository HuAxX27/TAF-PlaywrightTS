---
name: aqa-learning-report
description: Muestra la base de conocimiento AQA compartida y sus métricas sin modificarla.
disable-model-invocation: true
model: haiku
effort: low
allowed-tools: Bash(npm run --silent aqa:toolkit -- knowledge-report) PowerShell(npm run --silent aqa:toolkit -- knowledge-report)
---

Ejecuta `npm run --silent aqa:toolkit -- knowledge-report` y resume salud, reglas, recetas y hechos.
Señala entradas potencialmente obsoletas o sensibles para revisión, pero no las edites.
