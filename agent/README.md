# Agente AQA

De una User Story a specs de Playwright, sin duplicar lo que ya está automatizado.

> ¿Primera vez? Empieza por la **[guía de uso](GUIA.md)**: recorrido paso a paso,
> cómo funciona por dentro y guion para presentarlo. Este archivo es la referencia.

```
User Story (Jira o archivo)
        │
        ▼
  1. Diseño de Test Cases            ← LLM
        │
        ▼
  2. Inventario del framework        ← playwright test --list (sin LLM)
        │
        ▼
  3. Análisis de cobertura           ← LLM   → covered / partial / missing
        │
        ▼
  4. Generación de código (solo lo faltante)   ← LLM
        │
        ▼
  5. Validación real + reparación    ← tsc, eslint, playwright --list (sin LLM)
        │
        ▼
  tests/generated/*.spec.ts  +  agent/artifacts/<HISTORIA>/
```

## Uso

```bash
npm run agent -- DEMO-1 --source=file --provider=mock
```

| Flag                  | Qué hace                                                              |
| --------------------- | --------------------------------------------------------------------- |
| `--source=jira\|file` | De dónde sale la historia. `file` lee `agent/stories/<CLAVE>.md`      |
| `--provider=<nombre>` | `mock`, `gemini`, `groq`, `openrouter`, `ollama`, `codemie`, `custom` |
| `--dry-run`           | Analiza y reporta, no escribe código                                  |
| `--include-partial`   | También genera specs para los casos cubiertos a medias                |

Sin flags toma los valores de `.env` (`STORY_SOURCE`, `LLM_PROVIDER`).

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

## Qué deja cada corrida

En `agent/artifacts/<CLAVE>/` (ignorado por git):

| Archivo                      | Para qué                                                        |
| ---------------------------- | --------------------------------------------------------------- |
| `01-user-story.json`         | lo que el agente entendió de la historia                        |
| `02-test-cases.json` / `.md` | los TCs diseñados — el `.md` es el que subes a Jira/Xray/Zephyr |
| `03-inventory.json`          | todas las pruebas que ya existían                               |
| `04-coverage.json` / `.md`   | matriz de trazabilidad TC → prueba existente                    |
| `05-report.md`               | resumen ejecutivo de la corrida                                 |

Los specs van a `tests/generated/`. Si uno no pasa la validación después de los
reintentos de reparación se guarda como `.spec.ts.invalid`: se conserva para
revisión pero **queda fuera del alcance de Playwright**, para que un archivo
generado nunca deje la suite en rojo.

## Por qué el paso de validación importa

Sin él el agente solo "escribe archivos". El código generado se somete a las
mismas puertas que el código humano:

1. `playwright test --list <archivo>` — Playwright puede cargarlo y ve pruebas.
2. `tsc --noEmit` — compila en modo strict.
3. `eslint <archivo>` — respeta las reglas del repo.

Los errores reales se le devuelven al modelo (`MAX_REPAIR_ATTEMPTS`, default 2)
en vez de pedirle que adivine.

## Límites honestos

- El agente **no ejecuta** los tests contra el ambiente: valida que compilen y
  que Playwright los reconozca. Correrlos y revisar locators sigue siendo tuyo.
- Los locators que el modelo no encuentra en los Page Objects quedan como
  `// TODO: agregar locator a <Componente>`. Es intencional: preferimos un TODO
  visible a un selector CSS inventado.
- La cobertura la decide un LLM sobre títulos y tags, no sobre el cuerpo de cada
  prueba. Un caso marcado `covered` merece una mirada antes de descartarlo.
