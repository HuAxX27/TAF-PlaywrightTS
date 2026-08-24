# Documentación del Agente AQA

## 📚 Guías

### Para Empezar
- **[Guía de Uso](GUIA.md)** - Tutorial paso a paso para usar el agente
- **[README Principal](../README.md)** - Referencia técnica completa

### Características Avanzadas
- **[Sistema de Aprendizaje](LEARNING-SYSTEM.md)** - Cómo el agente aprende y mejora con el tiempo
- **[Convenciones generales](CONVENTIONS.md)** - Reglas y patrones del framework de testing
- **[Convenciones de UI](CONVENTIONS-UI.md)** - Specs con navegador: Page Objects, locators, overlays
- **[Convenciones de API](CONVENTIONS-API.md)** - Specs de servicio: services, status codes, contratos

## 🏗️ Arquitectura

### Componentes Principales

```
agent/
├── cli.ts                    # CLI principal con todas las opciones
├── createTestScript.ts       # CLI simplificado para Xray
├── pipeline.ts              # Orquestador principal del flujo
├── config.ts                # Configuración centralizada
├── types.ts                 # Tipos TypeScript compartidos
├── prompts.ts               # Templates de prompts para LLM
├── report.ts                # Generación de reportes
│
├── framework/               # Lógica core del agente
│   ├── context.ts          # Construcción de contexto para LLM (por tipo UI/API)
│   ├── classify.ts         # Clasificación UI vs API de cada test case
│   ├── human.ts            # Preguntas, aprobaciones y feedback del QA
│   ├── finalValidation.ts  # TC original vs código generado
│   ├── explore.ts          # Exploración en vivo del sitio
│   ├── inventory.ts        # Inventario de tests existentes
│   ├── validate.ts         # Validación estática (tsc, eslint)
│   ├── e2eValidation.ts    # Validación E2E contra app real
│   ├── multiAgent.ts       # Sistema de 3 agentes para reparación
│   ├── learning.ts         # Recolector de sesion + destilacion (LLM) al cerrar
│   ├── knowledge.ts        # Base de conocimiento: carga, merge, inyeccion en prompts
│   ├── fileBundle.ts       # Manejo de archivos generados
│   └── shell.ts            # Ejecución de comandos shell
│
├── llm/                     # Proveedores de IA
│   ├── provider.ts         # Interfaz común
│   ├── openAiCompatible.ts # Implementación para APIs OpenAI-compatible
│   ├── mock.ts             # Proveedor mock para demos/CI
│   └── index.ts            # Registro de proveedores
│
└── sources/                 # Fuentes de entrada
    ├── jiraSource.ts       # User Stories desde Jira
    ├── xrayTestCaseSource.ts # Test Cases desde Xray
    ├── fileSource.ts       # Archivos locales (.md, .json)
    └── index.ts            # Interfaz común
```

## 🔄 Flujo de Ejecución

### Modo Story (User Story → Test Cases → Specs)
```
1. Leer User Story (Jira o archivo)
2. Diseñar Test Cases (LLM)
3. REVISIÓN HUMANA: el agente pregunta lo que tendría que asumir, aplica tus
   respuestas y espera tu aprobación (o tus cambios) antes de continuar
4. Clasificar cada Test Case como UI o API (heurística + LLM + confirmación humana)
5. Inventario de tests existentes (playwright --list)
6. Análisis de cobertura (LLM)
7. Generación de código por tipo:
   - UI  → tests/ui/<módulo>/  con CONVENTIONS-UI.md  + exploración del sitio
   - API → tests/api/<módulo>/ con CONVENTIONS-API.md (sin navegador)
   Incluye validación estática, reparación, validación E2E, reparación
   multi-agente y APROBACIÓN HUMANA de cada spec
8. VALIDACIÓN FINAL: compara el Test Case original contra el código generado y
   reporta escenario por escenario qué quedó sin cubrir
9. Reporte final
```

### Modo TestCase (Test Case → Spec directo)
```
1. Leer Test Case (Xray o archivo)
2. [Salta el diseño, pero SÍ pasa por la revisión humana]
3-9. Igual que modo story
```

## 🙋 Involucramiento humano

El agente es interactivo por defecto. Puntos donde te consulta:

| Etapa | Qué pasa |
| --- | --- |
| Dudas del diseño | Lista lo que tendría que asumir (datos, mensajes, ambientes) y te lo pregunta. Enter vacío = acepta el supuesto que él propone. |
| Aprobación de Test Cases | No genera código hasta que apruebas. Puedes pedir `[c]ambios` describiéndolos, las veces que haga falta. |
| Clasificación UI/API | Si la confianza es menor a `KIND_CONFIDENCE_THRESHOLD`, te pide confirmar. |
| Aprobación de cada spec | Apruebas o pides que se regenere con tu feedback. |
| Cobertura incompleta | Si el código no cubre todos los escenarios del TC, decides si lo aceptas como pendiente (queda anotado en el spec). |

Para CI o ejecuciones desatendidas: `--yes` (o `INTERACTIVE=false`), que acepta
los supuestos del agente y aprueba automáticamente.

## 🧪 Separación UI / API

Cada test case se clasifica y su spec cae en la carpeta correspondiente:

```
tests/
├── ui/<módulo>/     Specs con navegador: Page Objects, locators, overlays
└── api/<módulo>/    Specs de servicio: services, status codes, contratos
```

La clasificación usa, en orden: el `kind` que ya trae la fuente, señales duras
(nivel `api`, tags `@api`/`@ui`, pasos que son verbos HTTP), vocabulario dominante
y, solo para los casos ambiguos, el LLM. Cada tipo recibe su propio contexto del
framework, sus convenciones y su playbook de reparación: a un test de API no se le
muestran los Page Objects, y tiene prohibido usar navegador.

## 🧠 Sistema de Aprendizaje

Al cerrar cada sesión, el agente destila en una sola llamada al LLM lo que pasó
(reparaciones, respuestas del QA, escenarios sin cubrir) y lo guarda en
**`agent/knowledge/`** — versionado en git, para que todo el equipo lo comparta:

- **Reglas** — lecciones normativas nacidas de un error real reparado o de una
  corrección del QA. Se inyectan solo en el prompt del tipo (UI/API) al que aplican.
- **Recetas** — código que ya funcionó para un problema recurrente.
- **Hechos del dominio** — datos que el agente no puede inferir del código (URLs,
  textos exactos, usuarios de prueba). Si una duda ya fue respondida antes, el
  agente **no vuelve a preguntar**.
- **Estadísticas** — % de specs que pasan sin reparación, promedio de intentos.

A diferencia de una versión anterior que solo repetía las convenciones del
framework (gastando tokens sin enseñar nada nuevo), este sistema filtra lo que
ya está en `CONVENTIONS*.md` y deduplica por significado.

Ver [LEARNING-SYSTEM.md](LEARNING-SYSTEM.md) para detalles completos.

## 🔧 Configuración

### Variables de Entorno Principales

```bash
# Proveedor de IA
LLM_PROVIDER=gemini              # mock, gemini, groq, openrouter, ollama, codemie, custom
GEMINI_API_KEY=tu-api-key        # Según el proveedor elegido

# Fuentes de datos
STORY_SOURCE=file                # jira o file (para modo story)
TESTCASE_SOURCE=xray             # xray o file (para modo testcase)

# Jira (si STORY_SOURCE=jira)
JIRA_BASE_URL=https://...
JIRA_EMAIL=tu-email
JIRA_API_TOKEN=tu-token

# Xray (si TESTCASE_SOURCE=xray)
XRAY_CLIENT_ID=tu-client-id
XRAY_CLIENT_SECRET=tu-secret

# Aplicación bajo test
BASE_URL=http://localhost:3000

# Validación E2E (opcional)
ENABLE_E2E_VALIDATION=false      # true para ejecutar tests contra app real
MAX_E2E_REPAIR_ATTEMPTS=3        # intentos de reparación con multi-agentes

# Ajustes del LLM
LLM_TEMPERATURE=0.2              # creatividad (0.0-1.0)
MAX_REPAIR_ATTEMPTS=2            # intentos de reparación estática

# Involucramiento humano
INTERACTIVE=false                # desactiva preguntas y aprobaciones (igual que --yes)
MAX_REVIEW_ROUNDS=5              # rondas máximas de pregunta/cambios
KIND_CONFIDENCE_THRESHOLD=80     # bajo este valor, confirma UI/API contigo

# Validación final (TC original vs código generado)
ENABLE_FINAL_VALIDATION=false    # desactiva la comparación de cierre

# Aprendizaje (agent/knowledge/, versionado en git)
ENABLE_LEARNING=false             # no destila al cerrar la sesión
KNOWLEDGE_CONTEXT_CHARS=6000      # tope de caracteres de conocimiento por prompt
MAX_RULES_IN_PROMPT=12
MAX_RECIPES_IN_PROMPT=3
MAX_FACTS_IN_PROMPT=15
MAX_NEW_RULES_PER_SESSION=5        # techo por sesión: prioriza en vez de inflar la base
MAX_NEW_FACTS_PER_SESSION=10
```

## 📊 Artefactos Generados

Cada ejecución crea una carpeta `agent/artifacts/<CLAVE>/` con:

```
01-user-story.json       # User Story original (solo modo story)
02-test-cases.md         # Test Cases aprobados (con tus aportes aplicados)
02b-kind-decisions.json  # Clasificación UI/API con justificación
03-inventory.json        # Inventario de tests existentes
04-coverage.md           # Análisis de cobertura
05-report.md             # Resumen de la ejecución
06-final-validation.md   # TC original vs código generado, escenario por escenario
07-human-review.json     # Preguntas, respuestas y aprobaciones (trazabilidad)
```

El aprendizaje NO va en `artifacts/` (que está gitignoreado): vive en
`agent/knowledge/knowledge-base.json` y `agent/knowledge/KNOWLEDGE.md`,
versionados en git para compartirse con el equipo.

## 🧪 Testing y Validación

### Validación Estática (siempre activa)
1. **TypeScript** - Compilación en modo strict
2. **ESLint** - Linting del código generado
3. **Playwright** - Verificación de sintaxis de tests (`--list`)

### Validación E2E (activa por defecto, `ENABLE_E2E_VALIDATION=false` para apagar)
1. **Ejecución real** - Corre el test contra la aplicación
2. **Captura de errores** - Screenshots, traces, logs
3. **Multi-agente** - 3 agentes especializados analizan y reparan:
   - **Analizador** - Diagnostica causa raíz (con playbook distinto para UI y API)
   - **Reparador** - Genera código corregido
   - **Validador** - Revisa coherencia

### Validación final (activa por defecto, `ENABLE_FINAL_VALIDATION=false` para apagar)
Compara el Test Case **original** contra el código que realmente se escribió y
descompone el TC en escenarios verificables. Un `test.step` con el nombre correcto
pero sin `expect` no cuenta como cubierto. Si algo falta, se anota en el encabezado
del spec y tú decides si lo aceptas como pendiente.

Que un spec compile y pase no garantiza que pruebe lo que el TC pedía: el modelo
puede haber aflojado una aserción durante la reparación. Esta etapa es la única que
detecta esa deriva.

## 🎯 Convenciones del Framework

El agente sigue convenciones estrictas: [CONVENTIONS.md](CONVENTIONS.md) (generales),
[CONVENTIONS-UI.md](CONVENTIONS-UI.md) y [CONVENTIONS-API.md](CONVENTIONS-API.md):

- ✅ Page Object Model
- ✅ Fixtures personalizadas
- ✅ Locators semánticos (`getByRole`, `getByText`)
- ✅ Auto-waiting de Playwright
- ✅ Test steps para organización
- ❌ NO `waitForTimeout`
- ❌ NO selectores CSS
- ❌ NO try-catch para control de flujo

## 🚀 Comandos Útiles

```bash
# Generar desde Xray (con reporte de aprendizaje automático)
npm run createTestScript -- CINE-34

# Generar desde User Story
npm run agent -- DEMO-1 --source=file --provider=gemini

# Ver reporte de aprendizaje
npm run agent:learning

# Demo con proveedor mock (sin API key)
npm run agent:demo

# Dry-run (analiza sin escribir código)
npm run agent -- CINE-123 --dry-run

# Incluir casos parcialmente cubiertos
npm run agent -- CINE-123 --include-partial
```

## 📖 Recursos Adicionales

- [Playwright Documentation](https://playwright.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)

## 🤝 Contribuir

Para agregar nuevas funcionalidades:

1. **Nuevo proveedor de IA**: Implementa `LlmProvider` en `llm/`
2. **Nueva fuente de datos**: Implementa interfaces en `sources/`
3. **Nueva validación**: Extiende `validate.ts` o `e2eValidation.ts`
4. **Nuevas convenciones**: Actualiza `CONVENTIONS.md`

## 📝 Notas de Desarrollo

- El código usa TypeScript strict mode
- Todos los módulos son CommonJS (`type: "commonjs"` en package.json)
- Los prompts están en `prompts.ts` para fácil ajuste
- La configuración está centralizada en `config.ts`
- Los tipos compartidos están en `types.ts`
