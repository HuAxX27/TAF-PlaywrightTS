# Agente AQA

De una User Story o de un Test Case ya definido en Xray, a specs de Playwright
completos (spec + Page Objects + fixtures), sin duplicar lo que ya está automatizado.

> ¿Primera vez? Empieza por la **[guía de uso](GUIA.md)**: recorrido paso a paso,
> cómo funciona por dentro y guion para presentarlo. Este archivo es la referencia.

El agente tiene dos modos de entrada que comparten el mismo pipeline de
cobertura y generación:

```
--mode=story (default)              --mode=testcase
User Story (Jira o archivo)          Test Case ya definido (Xray o archivo)
        │                                     │
        ▼                                     │
  Diseño de Test Cases  ← LLM                  │
        │                                     │
        └──────────────────┬──────────────────┘
                            ▼
              Inventario del framework        ← playwright test --list (sin LLM)
                            ▼
              Análisis de cobertura           ← LLM   → covered / partial / missing
                            ▼
              Exploración en vivo del sitio   ← Playwright headless (snapshot de accesibilidad)
                            ▼
              Generación de spec + Page Objects/components/fixtures que falten  ← LLM
                            ▼
              Validación real + reparación    ← tsc, eslint, playwright --list (sin LLM)
                            ▼
              tests/<modulo>/*.spec.ts + src/pages|components|fixtures/*  +  agent/artifacts/<CLAVE>/
```

## Uso

Para un Test Case ya definido en Xray, el comando simple:

```bash
npm run createTestScript -- CINE-34
```

Equivale a `--mode=testcase --source=xray --provider=codemie --include-partial`.

Para cualquier otra combinación (User Story, otro proveedor, dry-run, etc.) usa
el comando genérico:

```bash
npm run agent -- DEMO-1 --source=file --provider=mock
```

| Flag                    | Qué hace                                                                     |
| ----------------------- | ----------------------------------------------------------------------------- |
| `--mode=story\|testcase` | `story` diseña TCs desde una User Story (default). `testcase` toma un TC ya definido. |
| `--source=<nombre>`     | modo `story`: `jira\|file`. modo `testcase`: `xray\|file`.                    |
| `--provider=<nombre>`   | `mock`, `gemini`, `groq`, `openrouter`, `ollama`, `codemie`, `custom`          |
| `--dry-run`             | Analiza y reporta, no escribe código                                          |
| `--include-partial`     | También genera specs para los casos cubiertos a medias                        |

Sin flags toma los valores de `.env` (`STORY_SOURCE`, `TESTCASE_SOURCE`, `LLM_PROVIDER`).

La subcarpeta de `tests/` donde cae cada spec se toma del prefijo `[modulo]` en
el título del test case (p.ej. `[Login] ...` → `tests/login/`). Sin ese
prefijo, se infiere del primer tag de dominio, o cae en `tests/generated/`.

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

| Archivo                      | Para qué                                                        |
| ----------------------------- | ----------------------------------------------------------------- |
| `01-user-story.json`         | (solo modo `story`) lo que el agente entendió de la historia    |
| `02-test-cases.json` / `.md` | los TCs — el `.md` es el que subes a Jira/Xray/Zephyr           |
| `03-inventory.json`          | todas las pruebas que ya existían                               |
| `04-coverage.json` / `.md`   | matriz de trazabilidad TC → prueba existente                    |
| `05-report.md`               | resumen ejecutivo de la corrida                                 |

Cada spec cae en `tests/<modulo>/` (ver Uso arriba) junto con cualquier Page
Object, componente o fixture nuevo en `src/pages|components|data|fixtures/`.
Los specs generados llevan el comentario `// Generado por el Agente AQA` como
primera línea, para poder identificarlos aunque compartan carpeta con specs
manuales.

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

## Exploración en vivo del sitio

Antes de generar código, el agente abre la página en un Chromium headless
([`framework/explore.ts`](framework/explore.ts)) y captura su snapshot de
accesibilidad (roles y textos reales). Si el test case menciona login o
autenticación, primero intenta hacer click en un trigger razonable ("Iniciar
sesión", "Mi cuenta", etc.) para revelar esa UI antes de la foto. El LLM recibe
ese snapshot y debe usar esos roles/textos exactos para los locators — solo
puede dejar un `// TODO` si la exploración falló (sin `BASE_URL`, sitio caído,
etc.), nunca como salida fácil.

## Límites honestos

- El agente **no ejecuta** los tests contra el ambiente: valida que compilen y
  que Playwright los reconozca. Correrlos y confirmar el resultado sigue siendo
  tuyo.
- La exploración en vivo ve la página en el momento de generar el spec. Si el
  login real requiere pasos que el trigger automático no encuentra, el modelo
  deja un comentario de precondición explicando la suposición, no un TODO vacío.
- La cobertura la decide un LLM sobre títulos y tags, no sobre el cuerpo de cada
  prueba. Un caso marcado `covered` merece una mirada antes de descartarlo.
