# Sistema de Aprendizaje

## Por qué existe

Sin aprendizaje, el agente resuelve la misma duda y repara el mismo error en
cada corrida, sin importar cuántas veces ya lo haya hecho. Eso cuesta tokens,
tiempo y preguntas repetidas al QA.

Con aprendizaje: al cerrar cada sesión, el agente destila en **una sola
llamada al LLM** lo que pasó (qué hubo que reparar, qué preguntó al humano, qué
escenario quedó sin cubrir) y lo guarda como conocimiento reutilizable en
**`agent/knowledge/`**, versionado en git. La siguiente corrida —de cualquier
persona del equipo que haga `git pull`— arranca sabiendo eso.

## Dónde vive

```
agent/knowledge/
├── knowledge-base.json   # Fuente de verdad. Editable a mano. Se commitea.
└── KNOWLEDGE.md          # Vista legible, se regenera desde el .json. NO editar directo.
```

A diferencia de `agent/artifacts/` (gitignoreado, una carpeta por corrida), esto
**sí va al repo**: es memoria compartida por todo el equipo, no un log local.

## Qué se guarda

### Reglas (`rules`)

Lecciones normativas en imperativo: "haz X, nunca Y". Salen de tres fuentes,
nunca de una convención que ya está escrita en `CONVENTIONS*.md`:

1. **Reparación real**: el agente compara el código antes y después de arreglar
   un error y deduce la regla que lo habría evitado desde el principio.
2. **Corrección humana**: feedback del QA sobre un spec generado.
3. **Brecha de cobertura**: un escenario del test case que el código no llegó a
   cubrir.

Cada regla tiene un `scope` (`ui` | `api` | `both`) y un `trigger` (el síntoma
que indica cuándo aplica), y se inyecta solo en el prompt del tipo de test al
que corresponde.

### Recetas (`recipes`)

Código ya verificado (compiló, pasó E2E) para un problema recurrente. El
modelo lo reutiliza en vez de reinventarlo cada vez.

### Hechos del dominio (`facts`)

Datos que el agente **no puede inferir del código**: URLs, rutas de PDFs,
textos exactos, usuarios de prueba, mensajes de error del negocio. Casi
siempre vienen de una respuesta del QA a una pregunta del agente. Cada hecho
guarda la pregunta que responde, para poder reconocerla en sesiones futuras:
si alguien vuelve a preguntar algo ya contestado, el agente **no interrumpe**
al humano, usa la respuesta guardada.

Este es el ahorro más directo del sistema: menos preguntas repetidas, menos
tokens gastados en redescubrir lo mismo.

### Estadísticas

Estas se acumulan siempre, aunque el LLM no aporte lecciones nuevas:

- `specsGenerated` / `specsPassedFirstTry` — para ver si el % de éxito sin
  reparación sube con el tiempo.
- `averageRepairAttempts` — si no baja entre sesiones, el aprendizaje no está
  funcionando de verdad.
- `questionsAvoidedByFacts` — cuántas preguntas se evitaron gracias a un hecho
  ya conocido.

## Cómo se usa en cada corrida

```
Nueva sesión
    │
    ▼
Cargar agent/knowledge/knowledge-base.json
    │
    ├─ Reglas y recetas del scope (UI/API) → contexto del prompt de codegen
    ├─ Hechos del dominio del área del test case → mismo prompt
    └─ ¿Una duda detectada ya tiene un hecho que la responde?
         → se aplica sin preguntar al QA
    │
    ▼
Generar / reparar / revisar con humano (igual que siempre)
    │
    ▼
Cerrar sesión: UNA llamada al LLM que destila
    - repairs (antes/después de cada reparación)
    - humanInput (respuestas y feedback)
    - coverageGaps (escenarios sin cubrir)
    │
    ▼
Fusionar en la base (sin duplicar: una lección equivalente
solo suma "confirmaciones", no crea una entrada nueva)
    │
    ▼
Guardar knowledge-base.json + regenerar KNOWLEDGE.md
```

## Por qué esto sí ahorra tokens

Una versión anterior de este sistema guardaba "patrones exitosos" detectando
si el código contenía un substring como `test.step(` y concluía "usa
`test.step` para organizar pasos": algo que **ya está** en `CONVENTIONS.md` y
en cada prompt de codegen. Repetirlo no enseñaba nada nuevo, solo inflaba el
contexto y gastaba más tokens en cada corrida, justo lo contrario del
objetivo.

Este diseño lo evita de tres formas:

1. **Filtro explícito**: al destilar, se descarta cualquier "lección" que
   reformule una convención ya existente (`isRestatingConventions` en
   [`learning.ts`](../framework/learning.ts)).
2. **Deduplicación por significado**: una regla, receta o hecho nuevo se
   compara por solapamiento de palabras clave contra lo que ya existe; si
   coincide, solo sube el contador de confirmaciones en vez de crear una
   entrada.
3. **Presupuesto e inyección selectiva**: solo se manda al prompt lo que
   aplica al `scope` (UI o API) del test case actual, priorizando lo más
   confirmado o incumplido, con un tope de caracteres
   (`KNOWLEDGE_CONTEXT_CHARS`).

## Comandos

```bash
# Ver la base de conocimiento actual
npm run agent -- --learning-report

# El archivo para compartir con el equipo (se genera solo, no editarlo a mano)
cat agent/knowledge/KNOWLEDGE.md
```

## Cómo mantenerla

- **Editar una lección mal redactada**: modifica el campo `rule` en
  `knowledge-base.json` y commitea. `KNOWLEDGE.md` se regenera en la
  siguiente corrida.
- **Borrar una lección incorrecta**: quita su entrada del `.json`.
- **Agregar conocimiento a mano** (sin esperar a que el agente lo detecte):
  copia una entrada existente, dale un id nuevo y usa `"origin": "seed"`
  (reglas) o `"source": "human"` (hechos).
- **Una regla con muchos `violationsAfterLearning`**: señal de que está
  ambigua o de que el prompt no la está respetando; reescríbela en imperativo
  con un `trigger` más concreto.
- **Nunca** va aquí una contraseña, token o secreto: el archivo se commitea al
  repo. La destilación filtra cualquier hecho que contenga palabras como
  `password`, `token` o `secret`, pero conviene revisarlo igual en el PR.

## Desactivarlo

```bash
ENABLE_LEARNING=false   # no destila al cerrar (las estadísticas tampoco se actualizan)
```

Ver [CONVENTIONS.md](CONVENTIONS.md), [CONVENTIONS-UI.md](CONVENTIONS-UI.md) y
[CONVENTIONS-API.md](CONVENTIONS-API.md) para las reglas que el agente sigue
siempre y que **no** deberían terminar duplicadas en la base de conocimiento.

---

## Anexo: Convenciones Explícitas (CONVENTIONS.md)

**Problema anterior**: El agente dependía de specs existentes como modelo, lo que impedía empezar con un framework limpio.

**Solución**: Archivo [CONVENTIONS.md](CONVENTIONS.md) con convenciones explícitas que reemplazan la necesidad de specs de ejemplo.

#### Contenido de CONVENTIONS.md

- ✅ Estructura de archivos y carpetas
- ✅ Convenciones de specs (imports, estructura, reglas)
- ✅ Prohibiciones estrictas (waitForTimeout, selectores CSS, etc.)
- ✅ Convenciones de Page Objects
- ✅ Convenciones de Components
- ✅ Convenciones de datos de prueba
- ✅ Convenciones de fixtures
- ✅ Patrones comunes (login, navegación, verificaciones)
- ✅ TypeScript strict
- ✅ Nomenclatura
- ✅ Ejemplo completo

#### Ventajas

1. **Framework limpio desde cero**: Puedes borrar todos los specs y empezar de nuevo
2. **Convenciones consistentes**: Todos los tests siguen las mismas reglas
3. **Fácil de mantener**: Actualizar convenciones en un solo lugar
4. **Documentación viva**: Las convenciones son la documentación del framework
