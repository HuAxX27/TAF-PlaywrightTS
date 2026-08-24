# Guía de uso — Agente AQA

Esta guía es un recorrido práctico: qué hace el agente, cómo correrlo desde cero,
qué produce y cómo funciona por dentro. Para la referencia seca de flags y
proveedores está [README.md](README.md).

---

## 1. Qué resuelve

El ciclo manual de AQA es siempre el mismo:

> leer la historia (o el TC ya escrito) → diseñar/confirmar los test cases →
> buscar si ya hay algo automatizado que los cubra → escribir el spec de lo que
> falta, con sus Page Objects → pelearse con que compile.

El agente automatiza ese ciclo completo y se detiene justo donde empieza el juicio
humano: **correr las pruebas contra el ambiente real y confirmar el resultado**.

Lo importante no es que "escribe tests con IA". Es que **no duplica** (antes de
generar nada, inventaría lo que el framework ya tiene) y **no adivina locators**
(explora la página real antes de escribir el spec).

Tiene dos modos de entrada:

- `--mode=story` (default): parte de una User Story y el LLM diseña los test
  cases.
- `--mode=testcase`: parte de un Test Case ya definido en Xray (o un CSV/JSON
  local) y va directo a cobertura + generación. Este es el modo del comando
  simplificado `npm run createTestScript -- <CLAVE>`.

---

## 2. Puesta en marcha

```bash
npm ci
cp .env.example .env
```

El `.env` mínimo para el demo — no necesita API key ni internet:

```bash
BASE_URL=https://www.cinepolis.com
LLM_PROVIDER=mock
STORY_SOURCE=file
```

> `BASE_URL` es obligatorio porque el agente invoca `playwright test --list`, y
> `playwright.config.ts` lo exige al cargar. `USER_EMAIL` / `USER_PASSWORD` solo
> se piden si una prueba realmente los usa.

No hace falta `npx playwright install`: el agente nunca abre un navegador.

---

## 3. Tu primera corrida

```bash
npm run agent:demo
```

Equivale a `npm run agent -- DEMO-1 --source=file --provider=mock`. La historia
de ejemplo está en [`stories/DEMO-1.md`](stories/DEMO-1.md) y describe los
documentos legales del footer — el mismo dominio que ya cubre
`tests/footerLegales.spec.ts`, para que se vea la deduplicación funcionando.

Salida real:

```
Agente AQA  |  historia: DEMO-1
   proveedor: mock (deterministic-rules-v1)   origen: file

1/5  Leyendo la User Story...
     "Documentos legales accesibles desde el footer" - 7 criterios de aceptacion
2/5  Disenando test cases a partir de la historia...
     8 test cases propuestos
3/5  Inventariando las pruebas que ya existen...
     6 pruebas existentes (via playwright)
4/5  Comparando test cases contra la cobertura actual...
     cubiertos: 6  |  parciales: 0  |  faltantes: 2
5/5  Generando 2 specs...
     - TC-06 El enlace de Formato de reclamo Garantia Cinepolis esta visible...
       OK: compila y Playwright lo reconoce
     - TC-08 Comportamiento ante datos invalidos o estado inesperado
       OK: compila y Playwright lo reconoce
```

**Corre el mismo comando otra vez.** Esta es la demostración que vale:

```
3/5  Inventariando las pruebas que ya existen...
     8 pruebas existentes (via playwright)
4/5  Comparando test cases contra la cobertura actual...
     cubiertos: 8  |  parciales: 0  |  faltantes: 0
5/5  Nada que generar: la historia ya esta cubierta por las pruebas actuales.
```

El agente ve sus propios specs de la corrida anterior y no vuelve a generarlos.
No lleva estado en ningún lado: la fuente de verdad es el repositorio.

---

## 4. Qué dejó la corrida

### `tests/<modulo>/*.spec.ts`

Los specs nuevos, agrupados por módulo (el prefijo `[modulo]` del título del TC,
o el primer tag de dominio). Con el proveedor `mock` traen `TODO` en lugar de
acciones, porque el mock no razona — pero **compilan y Playwright los
reconoce**:

```ts
import { test, expect } from "../../src/fixtures/test";

test.describe("TC-06 - El enlace de Formato de reclamo...", () => {
    test.beforeEach(async ({ homePage }) => {
        await homePage.open();
    });

    test("El enlace de Formato de reclamo...", { tag: ["@regression"] }, async ({ homePage }) => {
        await test.step("Paso 1: Navegar a la pagina principal", async () => {
            // TODO(mock): accion real del paso.
        });
        ...
    });
});
```

Fíjate que ya respeta las convenciones del repo: importa del fixture, usa
`homePage`, envuelve en `test.step`, declara tags con la firma correcta. Eso no
es casualidad — el paso 5 le manda al modelo tus Page Objects y un spec tuyo
como modelo a imitar (ver §8.5).

### `agent/artifacts/DEMO-1/`

| Archivo                      | Para qué sirve                                           |
| ---------------------------- | -------------------------------------------------------- |
| `01-user-story.json`         | lo que el agente entendió de la historia                 |
| `02-test-cases.json` / `.md` | los TCs diseñados — el `.md` es lo que subes a Jira/Xray |
| `03-inventory.json`          | todas las pruebas que ya existían, con archivo y tags    |
| `04-coverage.json` / `.md`   | matriz de trazabilidad TC → prueba existente             |
| `05-report.md`               | resumen ejecutivo de la corrida                          |

`02-test-cases.md` sale listo para revisión humana:

```markdown
### TC-01 - La seccion "Legales" del footer muestra el enlace de Terminos...

- **Nivel:** e2e
- **Prioridad:** critical
- **Tags:** @regression
- **Automatizable:** si

**Precondiciones**

- El usuario esta en la pagina principal

**Pasos**

1. Navegar a la pagina principal
2. Verificar: ...

**Resultado esperado:** ...
```

Y `04-coverage.md` es la matriz de trazabilidad — la tabla que normalmente se
arma a mano para el reporte de sprint:

| Test case | Estado   | Pruebas existentes                             |
| --------- | -------- | ---------------------------------------------- |
| TC-01     | Cubierto | `footerLegales.spec.ts :: Footer - Legales >…` |
| TC-06     | Falta    | -                                              |

Los artefactos están en `.gitignore`: son salida de una corrida, no código.

---

## 5. El bucle completo de trabajo

**Desde una User Story:**

```
1. Llega la historia         ──►  npm run agent -- CIN-1234 --source=jira
2. Revisas 02-test-cases.md  ──►  ajustas / apruebas / los subes a Jira
3. Revisas 04-coverage.md    ──►  confirmas que lo "cubierto" está bien cubierto
4. Revisas tests/<modulo>/   ──►  confirmas locators y aserciones contra el snapshot real
5. npx playwright test       ──►  contra el ambiente real
6. Apruebas el PR            ──►  quitas el comentario de marca, review normal
```

**Desde un TC ya definido en Xray:**

```
1. Llega el TC de Xray       ──►  npm run createTestScript -- CINE-34
2. Revisas 04-coverage.md    ──►  confirmas que no hay una prueba parecida ya cubriendo esto
3. Revisas tests/<modulo>/   ──►  confirmas locators y aserciones contra el snapshot real
4. npx playwright test       ──►  contra el ambiente real
5. Apruebas el PR            ──►  quitas el comentario de marca, review normal
```

Los pasos 2, 4 y 5 son humanos y no se negocian. El agente quita el trabajo
mecánico, no la responsabilidad.

Si solo quieres el análisis sin que escriba código:

```bash
npm run agent -- CIN-1234 --dry-run
```

---

## 6. Conectar un LLM real (gratis)

El `mock` sirve para demostrar el flujo, pero no razona. Para ver el agente de
verdad necesitas un proveedor real. Estos son gratuitos:

### Gemini — recomendado para empezar

Crea una API key en <https://aistudio.google.com/apikey> (no pide tarjeta), y en
tu `.env`:

```bash
LLM_PROVIDER=gemini
GEMINI_API_KEY=AIza...
```

```bash
npm run agent -- DEMO-1 --source=file
```

### Groq — el más rápido

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_...    # console.groq.com/keys
```

### Ollama — 100% local, sin key ni internet

```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

```bash
LLM_PROVIDER=ollama
```

Útil si la política de la empresa no deja mandar historias a un servicio externo.
La calidad del código generado baja respecto a los modelos grandes.

### CodeMie, cuando tengas acceso

```bash
LLM_PROVIDER=codemie
CODEMIE_API_KEY=...
```

Nada más. **Ni una línea de código cambia** — es el punto de la §8.3.

### Cambiar el modelo sin tocar código

Los defaults de cada proveedor envejecen. Se sobrescriben desde el `.env`:

```bash
LLM_MODEL=gemini-2.5-pro
LLM_BASE_URL=https://mi-gateway-interno/v1
```

---

## 7. Conectar Jira o Xray

### Jira (modo `story`)

```bash
STORY_SOURCE=jira
JIRA_BASE_URL=https://tuempresa.atlassian.net
JIRA_EMAIL=tu.correo@empresa.com
JIRA_API_TOKEN=...        # id.atlassian.com/manage-profile/security/api-tokens
```

```bash
npm run agent -- CIN-1234 --source=jira
```

Usa la REST API v3 y aplana el Atlassian Document Format a texto plano. Los
criterios de aceptación los busca, en orden:

1. El campo custom que le indiques con `JIRA_AC_FIELD=customfield_10001`.
2. Una sección titulada "Criterios de aceptación" / "Acceptance Criteria" dentro
   de la descripción.
3. Como último recurso, todas las viñetas de la descripción.

Si no encuentra criterios te avisa y sigue: los test cases salen más débiles,
pero salen.

### Xray (modo `testcase`)

Xray Cloud guarda los pasos manuales de un Test issue fuera de los campos
estándar de Jira — el token de Jira no los ve. Se necesita una API Key
**global de Xray** (Xray → Settings → API Keys, distinta del token de Jira):

```bash
TESTCASE_SOURCE=xray
XRAY_CLIENT_ID=...
XRAY_CLIENT_SECRET=...
```

```bash
npm run createTestScript -- CINE-34
```

Autentica contra `/api/v2/authenticate` y trae el Test (con `steps`, prioridad y
labels) via `/api/v2/graphql`.

### Sin Jira ni Xray, con archivo

**Historias** (`agent/stories/<CLAVE>.md`):

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

**Test cases** (`agent/testcases/<CLAVE>.json` o `<CLAVE>.csv`): el `.csv` es
el export nativo de Xray (columnas `Action`, `Data`, `Expected Result`) — solo
lo exportas de Xray y lo copias ahí, sin transcribir nada a mano.

---

## 8. Cómo funciona por dentro

### 8.1 Mapa de archivos

```
agent/
  cli.ts                    parseo de argumentos del comando generico (npm run agent)
  createTestScript.ts       comando simple: TC de Xray -> spec (npm run createTestScript)
  pipeline.ts               orquesta ambos modos (story / testcase), el corazon
  prompts.ts                todos los prompts, en un solo lugar
  report.ts                 render de los .md (test cases, cobertura, reporte)
  config.ts                 lee el .env y resuelve rutas
  types.ts                  UserStory, TestCase, CoverageItem, ...

  llm/
    provider.ts             la interfaz LlmProvider + extraccion de JSON
    openAiCompatible.ts     una clase que cubre 6 proveedores
    mock.ts                 proveedor determinista, sin red
    index.ts                createProvider(): el switch por LLM_PROVIDER

  sources/
    storySource.ts          la interfaz StorySource (modo story)
    jiraSource.ts           Jira Cloud v3 + aplanado de ADF
    fileSource.ts           markdown / json local (historias)
    testCaseSource.ts       la interfaz TestCaseSource (modo testcase)
    xrayTestCaseSource.ts   Xray Cloud GraphQL (Test + pasos manuales)
    fileTestCaseSource.ts   json / csv local (TCs, formato export de Xray)

  framework/
    inventory.ts            que pruebas existen ya
    context.ts              que sabe el modelo de TU framework
    explore.ts              exploracion en vivo del sitio (snapshot de accesibilidad)
    fileBundle.ts           parseo del bundle multi-archivo (spec + soporte)
    validate.ts             la puerta de calidad
    shell.ts                ejecucion de comandos con timeout
```

### 8.2 Los pasos del pipeline

| #   | Paso                     | ¿Usa LLM? | Qué hace                                                                 |
| --- | ------------------------ | --------- | ------------------------------------------------------------------------ |
| 1   | Leer la entrada          | modo `story`: sí | `story`: Jira/archivo → `UserStory`. `testcase`: Xray/archivo → `TestCase[]` ya listos |
| 2   | Inventariar el framework | no        | `playwright test --list --reporter=json`                                 |
| 3   | Analizar cobertura       | **sí**    | cada TC → `covered` / `partial` / `missing`, con justificación           |
| 4   | Explorar el sitio en vivo| no        | Chromium headless → snapshot de accesibilidad de la página bajo prueba   |
| 5   | Generar y validar        | **sí**    | solo lo `missing` (o `partial` con `--include-partial`): spec + Page Objects/fixtures que falten, luego `tsc` + `eslint` + `playwright --list` |

Detalles de diseño que importan:

- **El inventario no lo hace la IA.** Se le pregunta a Playwright, que es la
  única fuente que sabe de verdad qué pruebas existen (incluidas las generadas
  por bucles `for`, que un escaneo de texto se pierde). Si el comando falla, hay
  un respaldo por expresiones regulares sobre los `.spec.ts`, y te avisa que la
  precisión bajó.
- **Un TC sin veredicto se trata como `missing`.** Si el modelo devuelve una
  respuesta incompleta, preferimos revisar un spec de más a perder cobertura en
  silencio.
- **La exploración le da al LLM la verdad del sitio**, no una suposición: los
  locators generados deben poder resolverse con los roles/textos del snapshot.

### 8.3 Por qué cambiar de proveedor es una línea

Todo el pipeline habla con una sola interfaz — [`llm/provider.ts`](llm/provider.ts):

```ts
export interface LlmProvider {
    readonly name: string;
    readonly model: string;
    complete(request: CompletionRequest): Promise<string>;
}
```

`pipeline.ts` nunca menciona CodeMie, Gemini ni ningún proveedor: solo llama a
`provider.complete(...)`. Quién esté del otro lado lo decide `createProvider()`
leyendo `LLM_PROVIDER`.

Y como CodeMie, Gemini, Groq, OpenRouter, Ollama y LM Studio exponen el mismo
contrato `POST /chat/completions` de OpenAI, **los seis los cubre una sola
clase** parametrizada por URL, modelo y key. Agregar un proveedor compatible es
agregar una entrada al mapa `PRESETS`; agregar uno que **no** hable OpenAI
(Bedrock, Vertex nativo) es escribir una clase que implemente `LlmProvider`. El
resto del agente no se entera.

### 8.4 El ciclo validar → reparar

Sin esto, el agente solo "escribe archivos". El código generado (spec + todo
archivo de soporte que se haya tocado) pasa por las mismas puertas que el
código humano, en este orden ([`framework/validate.ts`](framework/validate.ts)):

1. `playwright test --list <spec>` — Playwright puede cargarlo y ve al menos
   una prueba declarada.
2. `npx tsc --noEmit` — compila en modo strict sobre todo el proyecto (si un
   Page Object nuevo rompe otro spec existente, se detecta aquí).
3. `npx eslint <spec> <soporte...>` — respeta las reglas del repo.

Si algo falla, **los errores reales se le devuelven al modelo** junto con todos
los archivos del bundle y el contexto del framework, y se reintenta
(`MAX_REPAIR_ATTEMPTS`, default 2). No se le pide que adivine: se le pasa el
mensaje exacto de `tsc`.

Si después de los reintentos sigue roto: el spec se guarda como
`.spec.ts.invalid` (fuera del alcance de Playwright) y **los archivos de
soporte se revierten a su contenido original** (o se borran, si el agente los
creó). Un intento fallido nunca deja tu suite en rojo ni el framework roto. El
proceso termina con código de salida 1 para que CI lo note.

### 8.5 Cómo sabe el modelo escribir _en tu_ framework

Dos fuentes de verdad se combinan en cada corrida:

**[`framework/context.ts`](framework/context.ts)** arma un paquete estático con:

- las convenciones del repo, escritas explícitamente;
- el archivo de fixtures completo;
- todos los Page Objects, componentes, capa API y factories de datos;
- **un spec tuyo ya escrito** (nunca uno generado, identificado por el
  comentario `// Generado por el Agente AQA`), como modelo a imitar.

Todo eso se trunca a `MAX_CONTEXT_CHARS` (24 000 por defecto).

**[`framework/explore.ts`](framework/explore.ts)** arma un snapshot dinámico:
abre la página real en un Chromium headless y captura su árbol de accesibilidad
(roles, textos, `[ref=eN]`) — el mismo formato que usa el MCP de Playwright. Si
el TC habla de login, primero intenta un click en un trigger razonable para
revelar esa UI antes de la foto.

Con ambos, el modelo puede reusar `homePage.footer.…` cuando ya existe, o crear
un Page Object nuevo con locators que apuntan a elementos que **de verdad están
en la página**, en vez de inventar selectores CSS. Solo se permite un
`// TODO` cuando la exploración en vivo falló (sin `BASE_URL`, sitio caído).

---

## 9. Extenderlo

**Agregar un proveedor compatible con OpenAI** → una entrada en `PRESETS`
([`llm/index.ts`](llm/index.ts)):

```ts
mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
    keyEnv: "MISTRAL_API_KEY",
},
```

**Agregar un proveedor que no hable OpenAI** → una clase que implemente
`LlmProvider` y un caso en `createProvider()`.

**Agregar una fuente de historias** (Azure DevOps, Rally, un CSV) → implementa
`StorySource` en `sources/` y regístrala en `sources/index.ts`.

**Agregar una fuente de test cases ya definidos** (Zephyr, TestRail) →
implementa `TestCaseSource` en `sources/` y regístrala en
`createTestCaseSource()` (`sources/index.ts`).

**Cambiar cómo piensa el agente** → todo está en
[`prompts.ts`](prompts.ts), sin código mezclado. Si tu equipo tiene una plantilla
de test cases (Gherkin, formato de Xray), se cambia ahí.

---

## 10. Referencia rápida

### Comandos

| Comando                              | Equivale a                                                          |
| ------------------------------------- | -------------------------------------------------------------------- |
| `npm run createTestScript -- <CLAVE>` | `agent --mode=testcase --source=xray --provider=codemie --include-partial` |
| `npm run agent -- <CLAVE> [flags]`    | comando genérico, cualquier combinación de flags                    |
| `npm run agent:demo`                  | `agent DEMO-1 --source=file --provider=mock`                        |

### Flags (`npm run agent`)

| Flag                     | Qué hace                                                                    |
| ------------------------ | ----------------------------------------------------------------------------- |
| `--mode=story\|testcase` | `story` diseña TCs desde una User Story (default). `testcase` usa un TC ya definido |
| `--source=<nombre>`      | modo `story`: `jira\|file`. modo `testcase`: `xray\|file`                     |
| `--provider=<nombre>`    | `mock`, `gemini`, `groq`, `openrouter`, `ollama`, `codemie`, `custom`         |
| `--dry-run`              | analiza y reporta, no escribe código                                         |
| `--include-partial`      | también genera specs para los casos cubiertos a medias                        |
| `-h`, `--help`           | ayuda                                                                          |

Sin flags, toma los valores del `.env`. La subcarpeta de `tests/` se toma del
prefijo `[modulo]` en el título del TC, o del primer tag de dominio.

### Variables de entorno

| Variable              | Default                    | Para qué                                |
| --------------------- | --------------------------- | --------------------------------------- |
| `LLM_PROVIDER`        | `mock`                      | qué proveedor usar                      |
| `LLM_MODEL`           | según proveedor              | sobrescribe el modelo                   |
| `LLM_BASE_URL`        | según proveedor              | sobrescribe el endpoint                 |
| `LLM_API_KEY`         | —                            | key genérica (gana sobre la del preset) |
| `LLM_TEMPERATURE`     | `0.2`                        | creatividad; bajo = más determinista    |
| `LLM_TIMEOUT_MS`      | `120000`                     | timeout por llamada                     |
| `MAX_REPAIR_ATTEMPTS` | `2`                          | reintentos de reparación por spec       |
| `MAX_CONTEXT_CHARS`   | `24000`                      | tope del contexto del framework         |
| `STORY_SOURCE`        | `file`                       | `jira` o `file` (modo `story`)          |
| `STORY_DIR`           | `agent/stories`              | dónde viven las historias locales       |
| `TESTCASE_SOURCE`     | `file`                       | `xray` o `file` (modo `testcase`)       |
| `TESTCASE_DIR`        | `agent/testcases`            | dónde viven los TCs locales (.json/.csv) |
| `XRAY_BASE_URL`       | `https://xray.cloud.getxray.app` | endpoint de Xray Cloud             |
| `XRAY_CLIENT_ID`      | —                            | API Key global de Xray (Settings > API Keys) |
| `XRAY_CLIENT_SECRET`  | —                            | secreto de esa misma API Key            |
| `ARTIFACTS_DIR`       | `agent/artifacts`            | dónde caen los reportes                 |

---

## 11. Problemas comunes

| Síntoma                                              | Causa y arreglo                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Missing required env variable: BASE_URL`            | falta el `.env`. `cp .env.example .env`                                                         |
| `Falta la API key del proveedor "gemini"`            | define `GEMINI_API_KEY` (o `LLM_API_KEY`) en el `.env`                                          |
| `No encontre la historia "X"`                        | crea `agent/stories/X.md`, o usa `--source=jira`                                                |
| `No encontre test cases definidos para "X"`          | crea `agent/testcases/X.json`/`.csv`, o usa `--source=xray`                                     |
| `! no se pudo listar con Playwright`                 | el inventario cayó al respaldo por regex; suele ser `BASE_URL` ausente o un spec que no compila |
| Todo sale `missing` aunque hay pruebas que lo cubren | revisa `03-inventory.json`: si está vacío, el problema es el inventario, no el análisis         |
| El modelo devuelve texto en vez del bundle `FILE:`   | baja `LLM_TEMPERATURE`, o usa un modelo más grande con `LLM_MODEL`                              |
| Specs `.spec.ts.invalid`                             | mira `05-report.md`: trae los errores de `tsc`/`eslint` que no se pudieron reparar              |
| `! exploracion en vivo fallo`                        | revisa `BASE_URL` en el `.env` y que el sitio responda; el spec se genera con un TODO en ese caso |
| Timeout con `ollama`                                 | el primer request carga el modelo en memoria; sube `LLM_TIMEOUT_MS`                             |

---

## 12. Guion para presentarlo en 5 minutos

1. **El problema** (30 s) — muestra `stories/DEMO-1.md` y
   `tests/footerLegales.spec.ts`: siete criterios, y algo ya automatizado. La
   pregunta cara es _qué falta_, no _cómo se escribe un test_.
2. **Una corrida** (1 min) — `npm run agent:demo`. Señala el paso de cobertura:
   6 cubiertos, 2 faltantes.
3. **La matriz** (1 min) — abre `agent/artifacts/DEMO-1/04-coverage.md`. Esa
   tabla se arma a mano en cada sprint.
4. **El código** (1 min) — abre el spec generado en `tests/<modulo>/`: usa los
   fixtures y los Page Objects que ya existen, no Playwright genérico.
5. **La deduplicación** (1 min) — corre `npm run agent:demo` otra vez: cero
   generados. El agente no repite trabajo.
6. **El cierre** (30 s) — `npm run createTestScript -- CINE-34` con un TC real de
   Xray: explora el sitio en vivo, genera el spec y el Page Object que falte, y
   corre sobre la infraestructura de CodeMie, sin cambiar código.

Si tienes una key de Gemini a mano, corre el paso 2 con `--provider=gemini` para
que el código generado tenga aserciones reales en vez de `TODO`.

---

## 13. Límites honestos

- El agente **no ejecuta** los tests contra el ambiente: valida que compilen y
  que Playwright los reconozca. Correrlos y confirmar el resultado es tuyo.
- La cobertura la decide un LLM sobre **títulos y tags**, no sobre el cuerpo de
  cada prueba. Un caso marcado `covered` merece una mirada antes de descartarlo.
- El proveedor `mock` no razona: aplica reglas fijas (un TC por criterio,
  coincidencia léxica para la cobertura). Los falsos positivos que veas en el
  demo son de esa regla, no del diseño del pipeline.
- La exploración en vivo ve la página en el momento de generar el spec; si el
  trigger de login no se encuentra, el modelo deja una precondición explicando
  la suposición, no un TODO vacío.
- Nada de esto reemplaza el criterio de un QA para decidir **qué vale la pena
  probar**. El agente propone; tú decides.
