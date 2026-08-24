# Agente AQA

Generación automática de tests de Playwright desde User Stories o Test Cases de Xray,
incluyendo specs, Page Objects y fixtures. Evita duplicación, aprende de cada generación
y valida contra la aplicación real.

> 📚 **Primera vez?** Lee la [guía de uso](docs/GUIA.md) para un recorrido completo.  
> 📖 **Documentación completa** en [docs/](docs/)

## 🚀 Inicio Rápido

### Generar desde Test Case de Xray
```bash
npm run createTestScript -- CINE-34
```
Genera el spec completo y muestra reporte de aprendizaje automáticamente.

### Generar desde User Story
```bash
npm run agent -- DEMO-1 --source=file --provider=mock
```

### Ver reporte de aprendizaje
```bash
npm run agent:learning
```

## 📋 Opciones de Línea de Comandos

| Flag                    | Qué hace                                                                     |
| ----------------------- | ----------------------------------------------------------------------------- |
| `--mode=story\|testcase` | `story` diseña TCs desde una User Story (default). `testcase` toma un TC ya definido. |
| `--source=<nombre>`     | modo `story`: `jira\|file`. modo `testcase`: `xray\|file`.                    |
| `--provider=<nombre>`   | `mock`, `gemini`, `groq`, `openrouter`, `ollama`, `codemie`, `custom`          |
| `--dry-run`             | Analiza y reporta, no escribe código                                          |
| `--include-partial`     | También genera specs para los casos cubiertos a medias                        |
| `--yes`                 | No interactivo: acepta los supuestos del agente y aprueba solo (CI)           |

Sin flags toma los valores de `.env` (`STORY_SOURCE`, `TESTCASE_SOURCE`, `LLM_PROVIDER`).

## 🙋 Involucramiento humano

Por defecto el agente **no cierra el proceso hasta que apruebas**. Te consulta en:

1. **Dudas del diseño** — lista lo que tendría que asumir (datos de prueba, mensajes
   exactos, ambientes, precondiciones) y te lo pregunta una por una. Enter vacío
   acepta el supuesto que él propone, y queda registrado como supuesto.
2. **Aprobación de los Test Cases** — `[s]i` continúa, `[c]ambios` los regenera con
   tu descripción, `[a]bortar` corta. Puedes iterar las veces que haga falta.
3. **Clasificación UI/API** — si la confianza es baja, te pide confirmar.
4. **Aprobación de cada spec** — apruebas o pides que se regenere con tu feedback.
5. **Cobertura incompleta** — si el código no cubre todos los escenarios del TC,
   decides si lo aceptas como pendiente (queda anotado en el encabezado del spec).

Todo lo que aportas queda en `07-human-review.json` y en el reporte final.

Para CI: `--yes` o `INTERACTIVE=false`.

## 🧪 Separación UI / API

Cada test case se clasifica y su spec cae en la carpeta que le corresponde:

```
tests/
├── ui/<módulo>/     Page Objects, locators, manejo de overlays
└── api/<módulo>/    Services, status codes, contratos (sin navegador)
```

Cada tipo recibe su propio contexto del framework, sus convenciones
([CONVENTIONS-UI.md](docs/CONVENTIONS-UI.md) / [CONVENTIONS-API.md](docs/CONVENTIONS-API.md))
y su playbook de reparación. A un test de API no se le muestran los Page Objects y
tiene prohibido abrir navegador.

El `<módulo>` se toma del prefijo `[modulo]` en el título del test case
(p.ej. `[Login] ...` → `tests/ui/login/`). Sin ese prefijo, se infiere del primer
tag de dominio, o cae en `generated`.

## Cambiar de proveedor de IA

Todo el pipeline habla con una sola interfaz — [`llm/provider.ts`](llm/provider.ts):

```ts
interface LlmProvider {
    readonly name: string;
    readonly model: string;
    complete(request: CompletionRequest): Promise<string>;
}
```

CodeMie, Gemini, Groq, OpenRouter, Ollama y LM Studio exponen el mismo contrato
`POST /chat/completions` de OpenAI, así que **los seis los cubre una sola clase**
([`llm/openAiCompatible.ts`](llm/openAiCompatible.ts)). Cambiar de proveedor es
cambiar una línea del `.env`:

```bash
LLM_PROVIDER=gemini     # o groq, openrouter, ollama, codemie
```

| Proveedor    | Costo                    | Qué necesitas                                                                 | Modelo por defecto                    |
| ------------ | ------------------------ | ----------------------------------------------------------------------------- | ------------------------------------- |
| `mock`       | —                        | nada, ni red ni key                                                           | reglas deterministas                  |
| `gemini`     | gratis (free tier)       | `GEMINI_API_KEY` de [aistudio.google.com](https://aistudio.google.com/apikey) | `gemini-2.5-flash`                    |
| `groq`       | gratis (free tier)       | `GROQ_API_KEY` de [console.groq.com](https://console.groq.com/keys)           | `llama-3.3-70b-versatile`             |
| `openrouter` | gratis (modelos `:free`) | `OPENROUTER_API_KEY`                                                          | `deepseek/deepseek-chat-v3-0324:free` |
| `ollama`     | gratis, 100% local       | `ollama serve` corriendo                                                      | `qwen2.5-coder:7b`                    |
| `codemie`    | corporativo EPAM         | `CODEMIE_API_KEY`                                                             | `gpt-4o`                              |
| `custom`     | —                        | `LLM_BASE_URL` + `LLM_API_KEY`                                                | el que definas                        |

Los defaults se sobrescriben sin tocar código:

```bash
LLM_MODEL=gemini-2.5-pro
LLM_BASE_URL=https://mi-gateway-interno/v1
```

Un proveedor que **no** hable OpenAI (Bedrock, Vertex nativo, un endpoint propio)
se agrega implementando `LlmProvider` en un archivo nuevo y registrándolo en
[`llm/index.ts`](llm/index.ts). El resto del agente no se entera.

### El proveedor `mock`

Determinista, sin red y sin API key. Sirve para dos cosas: demostrar el pipeline
completo en una presentación sin depender de ningún servicio, y probar el agente
en CI. **No razona**: aplica reglas fijas (un test case por criterio de
aceptación, coincidencia léxica para la cobertura, esqueleto de spec con `TODO`).
Los falsos positivos que veas en la cobertura del demo son de esa regla léxica,
no del diseño — un proveedor real compara comportamiento.

## Origen de la User Story

**Archivo** (`--source=file`) — `agent/stories/<CLAVE>.md`:

```markdown
# CIN-123 - Título de la historia

## Descripción

Como usuario quiero...

## Criterios de aceptación

- primer criterio
- segundo criterio

## Labels

footer, legales
```

También acepta `<CLAVE>.json` con la forma de `UserStory`.

**Jira** (`--source=jira`) — necesita `JIRA_BASE_URL`, `JIRA_EMAIL` y
`JIRA_API_TOKEN`. Usa la REST API v3 y aplana el Atlassian Document Format;
si tu proyecto guarda los criterios en un campo aparte, apúntalo con
`JIRA_AC_FIELD=customfield_10001`.

## Origen del Test Case (`--mode=testcase`)

**Xray** (`--source=xray`) — necesita `XRAY_CLIENT_ID` y `XRAY_CLIENT_SECRET`
(API Key global de Xray Cloud: Xray > Settings > API Keys, no el token de Jira).
Trae el Test issue completo via la API GraphQL de Xray, incluidos los pasos
manuales.

**Archivo** (`--source=file`) — `agent/testcases/<CLAVE>.json` o `<CLAVE>.csv`
(el export nativo de Xray, con columnas Action, Data, Expected Result). Sirve
para probar sin credenciales de Xray.

## Qué deja cada corrida

En `agent/artifacts/<CLAVE>/` (ignorado por git):

| Archivo                          | Para qué                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| `01-user-story.json`             | (solo modo `story`) lo que el agente entendió de la historia        |
| `02-test-cases.json` / `.md`     | los TCs aprobados — el `.md` es el que subes a Jira/Xray/Zephyr     |
| `02b-kind-decisions.json`        | clasificación UI/API de cada TC, con confianza y justificación      |
| `03-inventory.json`              | todas las pruebas que ya existían                                   |
| `04-coverage.json` / `.md`       | matriz de trazabilidad TC → prueba existente                        |
| `05-report.md`                   | resumen ejecutivo de la corrida                                     |
| `06-final-validation.json`/`.md` | TC original vs código generado, escenario por escenario             |
| `07-human-review.json`           | preguntas, tus respuestas y cada aprobación (trazabilidad)          |

Cada spec cae en `tests/ui/<modulo>/` o `tests/api/<modulo>/` (ver Separación
UI/API arriba) junto con cualquier Page Object, Service, componente o fixture
nuevo en `src/pages|components|api|data|fixtures/`. Los specs generados llevan el
comentario `// Generado por el Agente AQA` como primera línea, para poder
identificarlos aunque compartan carpeta con specs manuales.

Si un spec no pasa la validación después de los reintentos de reparación, se
guarda como `.spec.ts.invalid` y los archivos de soporte que se hayan tocado se
revierten a su estado original: un intento fallido nunca deja el framework roto
ni la suite en rojo.

## Por qué el paso de validación importa

Sin él el agente solo "escribe archivos". El código generado (spec + soporte)
se somete a las mismas puertas que el código humano:

1. `playwright test --list <spec>` — Playwright puede cargarlo y ve pruebas.
2. `tsc --noEmit` — compila en modo strict (todo el proyecto: si un Page Object
   nuevo rompe otro spec existente, se detecta aquí).
3. `eslint <spec> <soporte...>` — respeta las reglas del repo.

Los errores reales se le devuelven al modelo (`MAX_REPAIR_ATTEMPTS`, default 2)
en vez de pedirle que adivine.

### Validación E2E con Sistema Multiagente (Opcional)

Además de la validación estática, el agente puede ejecutar los tests generados
contra la aplicación real y repararlos automáticamente si fallan. Esta
funcionalidad usa un **sistema multiagente** con tres roles especializados:

1. **Agente Analizador** — diagnostica la causa raíz del fallo (timeout, selector
   incorrecto, assertion fallida, etc.) y clasifica el error.
2. **Agente Reparador** — propone correcciones específicas al código basándose
   en el análisis.
3. **Agente Validador** — revisa que las correcciones sean coherentes y no
   introduzcan nuevos problemas.

Para habilitar esta validación, configura en tu `.env`:

```bash
ENABLE_E2E_VALIDATION=true
MAX_E2E_REPAIR_ATTEMPTS=3  # intentos de reparación con multiagentes
```

**Flujo de validación E2E:**

```
Spec generado + validación estática OK
        │
        ▼
Ejecutar test contra app real  ← playwright test <spec>
        │
        ├─ ✓ Pasó → Listo
        │
        └─ ✗ Falló → Capturar errores, screenshots, traces
                │
                ▼
        [Agente Analizador] diagnostica causa raíz
                │
                ▼
        [Agente Reparador] genera código corregido
                │
                ▼
        [Agente Validador] revisa correcciones
                │
                ▼
        Aplicar correcciones y reintentar
                │
                └─ Repetir hasta MAX_E2E_REPAIR_ATTEMPTS
```

**Ventajas:**

- Tests funcionales desde el primer commit, no solo sintácticamente correctos
- Reparación automática de errores comunes (selectores, timing, assertions)
- Diagnóstico detallado con análisis de causa raíz
- Captura de screenshots y traces para debugging

**Consideraciones:**

- Requiere que `BASE_URL` esté configurado y la app sea accesible
- Aumenta el tiempo de generación (cada test se ejecuta al menos una vez)
- Consume más tokens del LLM (análisis + reparación por cada fallo)
- Los tests deben ser deterministas para que la reparación sea efectiva

Con `ENABLE_E2E_VALIDATION=false` el agente solo valida compilación y sintaxis.

El playbook de reparación es distinto según el tipo de test: para UI cubre
overlays promocionales, cookie banners y contenido lazy; para API cubre status
codes inesperados, métodos que lanzan antes de poder afirmar el status, y
respuestas que no son JSON. A un test de API el reparador no puede meterle
navegador ni Page Objects.

## Validación final: TC original vs código generado

Última puerta antes de cerrar ([`framework/finalValidation.ts`](framework/finalValidation.ts)).
Descompone el Test Case original en escenarios verificables (cada paso relevante y
cada afirmación del resultado esperado, por separado) y busca en el código la acción
**y** la aserción que los prueban:

- `covered` — el código ejecuta el escenario y lo afirma con un `expect`.
- `partial` — ejecuta la acción pero no verifica el resultado, o la aserción es más
  débil de lo que el TC pide.
- `missing` — el código no hace nada al respecto.

Un `test.step` con el nombre correcto pero con cuerpo vacío, comentado, con `TODO`
o marcado `test.fixme` **no cubre nada**.

Existe porque que un spec compile y pase no garantiza que pruebe lo que el TC pedía:
el modelo puede haber omitido un paso o aflojado una aserción durante la reparación.
Esta etapa es la única que detecta esa deriva. El resultado va a
`06-final-validation.md` y, si algo falta, se anota en el encabezado del spec.

Se apaga con `ENABLE_FINAL_VALIDATION=false`.

## Exploración en vivo del sitio

Solo para tests de UI (un test de API no tiene página). Antes de generar código, el
agente abre la página en un Chromium headless
([`framework/explore.ts`](framework/explore.ts)) y captura su snapshot de
accesibilidad (roles y textos reales). Si el test case menciona login o
autenticación, primero intenta hacer click en un trigger razonable ("Iniciar
sesión", "Mi cuenta", etc.) para revelar esa UI antes de la foto. El LLM recibe
ese snapshot y debe usar esos roles/textos exactos para los locators — solo
puede dejar un `// TODO` si la exploración falló (sin `BASE_URL`, sitio caído,
etc.), nunca como salida fácil.

## Límites honestos

- La exploración en vivo ve la página en el momento de generar el spec. Si el
  login real requiere pasos que el trigger automático no encuentra, el modelo
  deja un comentario de precondición explicando la suposición, no un TODO vacío.
- La cobertura la decide un LLM sobre títulos y tags, no sobre el cuerpo de cada
  prueba. Un caso marcado `covered` merece una mirada antes de descartarlo.
- La clasificación UI/API resuelve con heurísticas lo que tiene señales claras y
  delega el resto al LLM. Con `--yes` un caso ambiguo se resuelve sin preguntarte;
  revisa `02b-kind-decisions.json` en ese escenario.
- La validación final la juzga un LLM leyendo el código. Detecta aserciones
  faltantes o débiles, pero no ejecuta nada: un veredicto de 100% no reemplaza
  correr la suite.
- Con el proveedor `mock` no hay razonamiento: no detecta dudas reales ni puede
  juzgar cobertura. Sirve para probar el pipeline, no para generar tests usables.

## 🧠 Sistema de Aprendizaje

Al cerrar cada sesión, el agente destila lo que pasó en una sola llamada al LLM
y lo guarda en **`agent/knowledge/`**, versionado en git para compartirse con
todo el equipo:

- **Reglas** — de errores reparados o correcciones del QA, con el tipo (UI/API)
  al que aplican.
- **Recetas** — código ya verificado para problemas recurrentes.
- **Hechos del dominio** — datos que el agente no puede inferir del código
  (URLs, textos exactos, usuarios de prueba). Si ya se preguntó antes, **no se
  vuelve a preguntar**.
- **Estadísticas** — % de specs sin reparación, promedio de intentos: la forma
  de comprobar si el agente mejora de verdad de una corrida a la siguiente.

```bash
# Ver la base de conocimiento
npm run agent -- --learning-report
cat agent/knowledge/KNOWLEDGE.md
```

Se filtra lo que ya está en `CONVENTIONS*.md` (repetirlo solo gasta tokens) y se
deduplica por significado, no por texto exacto. Se apaga con `ENABLE_LEARNING=false`.

Ver documentación completa en [docs/LEARNING-SYSTEM.md](docs/LEARNING-SYSTEM.md)

## 📖 Documentación

- **[Guía de Uso](docs/GUIA.md)** - Tutorial paso a paso
- **[Sistema de Aprendizaje](docs/LEARNING-SYSTEM.md)** - Cómo el agente mejora con el tiempo
- **[Convenciones generales](docs/CONVENTIONS.md)** - Reglas del framework de testing
- **[Convenciones de UI](docs/CONVENTIONS-UI.md)** - Page Objects, locators, overlays
- **[Convenciones de API](docs/CONVENTIONS-API.md)** - Services, status codes, contratos
- **[Documentación Técnica](docs/)** - Arquitectura y referencia completa
