import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";
import type {
    KnowledgeBase,
    KnowledgeFact,
    KnowledgeRecipe,
    KnowledgeRule,
    KnowledgeScope,
    SessionLearningSummary,
    TestKind,
} from "../types";

/**
 * Memoria a largo plazo del agente, versionada en git.
 *
 * Vive en `agent/knowledge/` (NO en artifacts/, que esta gitignoreado) para que
 * el equipo la comparta, la revise en PRs y la edite a mano. El .json es la
 * fuente de verdad; el .md es la vista legible que se regenera desde el .json.
 */

const KNOWLEDGE_DIR = path.join(agentConfig.root, "agent/knowledge");
const KNOWLEDGE_FILE = path.join(KNOWLEDGE_DIR, "knowledge-base.json");
const KNOWLEDGE_DOC = path.join(KNOWLEDGE_DIR, "KNOWLEDGE.md");

const CURRENT_VERSION = "2.0.0";

/** Historial de sesiones que se conserva: suficiente para auditar, sin inflar el archivo. */
const MAX_HISTORY = 30;

export function knowledgeFilePath(): string {
    return KNOWLEDGE_FILE;
}

export function loadKnowledge(): KnowledgeBase {
    if (!fs.existsSync(KNOWLEDGE_FILE)) {
        return emptyKnowledge();
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf-8")) as Partial<KnowledgeBase>;
        return {
            version: parsed.version ?? CURRENT_VERSION,
            updatedAt: parsed.updatedAt ?? new Date().toISOString(),
            rules: parsed.rules ?? [],
            recipes: parsed.recipes ?? [],
            facts: parsed.facts ?? [],
            stats: { ...emptyKnowledge().stats, ...parsed.stats },
            history: parsed.history ?? [],
        };
    } catch (error) {
        // Una base corrupta no debe tumbar la corrida, pero tampoco se sobreescribe
        // en silencio: se avisa y se sigue con una vacia en memoria.
        console.warn(
            `     ! base de conocimiento ilegible (${error instanceof Error ? error.message : String(error)}); se ignora en esta corrida.`
        );
        return emptyKnowledge();
    }
}

export function saveKnowledge(knowledge: KnowledgeBase): void {
    knowledge.updatedAt = new Date().toISOString();
    knowledge.version = CURRENT_VERSION;
    knowledge.history = knowledge.history.slice(-MAX_HISTORY);

    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    fs.writeFileSync(KNOWLEDGE_FILE, `${JSON.stringify(knowledge, null, 2)}\n`, "utf-8");
    fs.writeFileSync(KNOWLEDGE_DOC, renderKnowledgeMarkdown(knowledge), "utf-8");
}

function emptyKnowledge(): KnowledgeBase {
    return {
        version: CURRENT_VERSION,
        updatedAt: new Date().toISOString(),
        rules: [],
        recipes: [],
        facts: [],
        stats: {
            sessions: 0,
            specsGenerated: 0,
            specsPassedFirstTry: 0,
            totalRepairAttempts: 0,
            averageRepairAttempts: 0,
            questionsAvoidedByFacts: 0,
        },
        history: [],
    };
}

// ---------------------------------------------------------------------------
// Inyeccion de contexto en los prompts
// ---------------------------------------------------------------------------

/**
 * El conocimiento que se le manda al modelo para generar un test de `kind`.
 *
 * Filtra por scope y prioriza por confianza, con un presupuesto de caracteres:
 * el objetivo del sistema es gastar MENOS tokens, asi que mandar la base entera
 * seria contraproducente. Las reglas que se incumplen mucho suben de prioridad
 * porque son las que el modelo necesita ver.
 */
export function knowledgeForPrompt(kind: TestKind): string {
    const knowledge = loadKnowledge();
    const budget = agentConfig.knowledgeContextChars;
    if (budget <= 0) return "";

    const rules = applicable(knowledge.rules, kind)
        .sort((a, b) => score(b) - score(a))
        .slice(0, agentConfig.maxRulesInPrompt);

    const recipes = applicable(knowledge.recipes, kind)
        .sort((a, b) => b.confirmations - a.confirmations)
        .slice(0, agentConfig.maxRecipesInPrompt);

    if (rules.length === 0 && recipes.length === 0) return "";

    const sections: string[] = [
        "LECCIONES APRENDIDAS EN CORRIDAS ANTERIORES DE ESTE REPOSITORIO",
        "(salieron de errores reales que hubo que reparar y de correcciones del QA;",
        "respetarlas evita repetir esos errores)",
        "",
    ];

    if (rules.length > 0) {
        sections.push("REGLAS:");
        for (const rule of rules) {
            sections.push(`- [${rule.id}] ${rule.rule}`);
            sections.push(`  cuando aplica: ${rule.trigger}`);
        }
        sections.push("");
    }

    if (recipes.length > 0) {
        sections.push("SOLUCIONES YA VERIFICADAS (reusalas en vez de reinventarlas):");
        for (const recipe of recipes) {
            sections.push(`- ${recipe.problem} (va en ${recipe.placement}):`);
            sections.push("```typescript");
            sections.push(recipe.code.trim());
            sections.push("```");
        }
    }

    return truncate(sections.join("\n"), budget);
}

/** Hechos del dominio ya conocidos, para el area de un test case. */
export function factsForPrompt(areas: string[]): string {
    const knowledge = loadKnowledge();
    if (knowledge.facts.length === 0) return "";

    const wanted = new Set(areas.map((area) => area.toLowerCase()));
    const relevant = knowledge.facts.filter(
        (fact) => wanted.size === 0 || wanted.has(fact.area.toLowerCase())
    );
    const facts = (relevant.length > 0 ? relevant : knowledge.facts).slice(
        0,
        agentConfig.maxFactsInPrompt
    );

    if (facts.length === 0) return "";

    return truncate(
        [
            "DATOS DEL DOMINIO YA CONFIRMADOS POR EL QA (son fuente de verdad, usalos tal cual",
            "y NO vuelvas a preguntar por ellos):",
            ...facts.map((fact) => `- ${fact.question} -> ${fact.answer}`),
        ].join("\n"),
        agentConfig.knowledgeContextChars
    );
}

/**
 * Busca si una duda ya fue respondida en una sesion anterior.
 *
 * Es el ahorro mas directo del sistema: no volver a molestar al humano ni a gastar
 * tokens por algo que ya se contesto.
 */
export function findKnownAnswer(question: string): KnowledgeFact | undefined {
    const knowledge = loadKnowledge();
    const wanted = keywords(question);
    if (wanted.length === 0) return undefined;

    let best: { fact: KnowledgeFact; overlap: number } | undefined;

    for (const fact of knowledge.facts) {
        const have = keywords(fact.question);
        const shared = wanted.filter((word) => have.includes(word)).length;
        // Se exige solapamiento alto en ambos sentidos: un match flojo daria una
        // respuesta equivocada, que es peor que preguntar de nuevo.
        const ratio = shared / Math.max(wanted.length, have.length);
        if (shared >= 3 && ratio >= 0.6 && (!best || shared > best.overlap)) {
            best = { fact, overlap: shared };
        }
    }

    return best?.fact;
}

export function recordAvoidedQuestions(count: number): void {
    if (count <= 0) return;
    const knowledge = loadKnowledge();
    knowledge.stats.questionsAvoidedByFacts += count;
    saveKnowledge(knowledge);
}

function applicable<T extends { scope: KnowledgeScope }>(items: T[], kind: TestKind): T[] {
    return items.filter((item) => item.scope === "both" || item.scope === kind);
}

/** Una regla que se sigue incumpliendo necesita mas visibilidad, no menos. */
function score(rule: KnowledgeRule): number {
    return rule.confirmations + rule.violationsAfterLearning * 3;
}

function truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max)}\n/* ...conocimiento truncado... */`;
}

const STOP_WORDS = new Set([
    "que",
    "cual",
    "cuales",
    "como",
    "para",
    "debe",
    "usar",
    "usa",
    "con",
    "los",
    "las",
    "del",
    "una",
    "uno",
    "por",
    "esta",
    "este",
    "sobre",
    "cuando",
    "donde",
    "hay",
    "son",
    "test",
    "caso",
]);

function keywords(text: string): string[] {
    return [
        ...new Set(
            text
                .toLowerCase()
                .normalize("NFD")
                .replace(/\p{Diacritic}/gu, "")
                .replace(/[^a-z0-9\s]/g, " ")
                .split(/\s+/)
                .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
        ),
    ];
}

// ---------------------------------------------------------------------------
// Merge de lo destilado
// ---------------------------------------------------------------------------

export interface DistilledKnowledge {
    rules: Array<Pick<KnowledgeRule, "scope" | "category" | "rule" | "trigger" | "origin">>;
    recipes: Array<Pick<KnowledgeRecipe, "scope" | "problem" | "code" | "placement">>;
    facts: Array<Pick<KnowledgeFact, "question" | "answer" | "area">>;
    violatedRules: string[];
    notes: string;
}

export interface MergeOutcome {
    newRules: number;
    newRecipes: number;
    newFacts: number;
    confirmedRules: number;
}

/**
 * Integra lo destilado sin duplicar: si una leccion equivalente ya existe, se
 * incrementa su contador de confirmaciones en vez de agregar una entrada nueva.
 * Asi la base crece en calidad y no en tamano.
 */
export function mergeDistilled(
    knowledge: KnowledgeBase,
    distilled: DistilledKnowledge,
    sessionKey: string
): MergeOutcome {
    const now = new Date().toISOString();
    const outcome: MergeOutcome = {
        newRules: 0,
        newRecipes: 0,
        newFacts: 0,
        confirmedRules: 0,
    };

    for (const incoming of distilled.rules) {
        const existing = knowledge.rules.find(
            (rule) => rule.scope === incoming.scope && similar(rule.rule, incoming.rule)
        );

        if (existing) {
            // Una misma sesion no puede inflar la confianza de una regla.
            if (!existing.sessions.includes(sessionKey)) {
                existing.confirmations++;
                existing.sessions.push(sessionKey);
                outcome.confirmedRules++;
            }
            existing.lastSeen = now;
            continue;
        }

        knowledge.rules.push({
            id: nextId(knowledge.rules, "R"),
            scope: incoming.scope,
            category: incoming.category,
            rule: incoming.rule,
            trigger: incoming.trigger,
            origin: incoming.origin,
            confirmations: 1,
            violationsAfterLearning: 0,
            firstSeen: now,
            lastSeen: now,
            sessions: [sessionKey],
        });
        outcome.newRules++;
    }

    for (const incoming of distilled.recipes) {
        const existing = knowledge.recipes.find(
            (recipe) => recipe.scope === incoming.scope && similar(recipe.problem, incoming.problem)
        );

        if (existing) {
            if (!existing.sessions.includes(sessionKey)) {
                existing.confirmations++;
                existing.sessions.push(sessionKey);
            }
            existing.lastSeen = now;
            // El codigo mas reciente gana: refleja el estado actual del framework.
            existing.code = incoming.code;
            continue;
        }

        knowledge.recipes.push({
            id: nextId(knowledge.recipes, "C"),
            scope: incoming.scope,
            problem: incoming.problem,
            code: incoming.code,
            placement: incoming.placement,
            confirmations: 1,
            firstSeen: now,
            lastSeen: now,
            sessions: [sessionKey],
        });
        outcome.newRecipes++;
    }

    for (const incoming of distilled.facts) {
        const existing = knowledge.facts.find((fact) => similar(fact.question, incoming.question));

        if (existing) {
            if (!existing.sessions.includes(sessionKey)) {
                existing.sessions.push(sessionKey);
            }
            existing.lastSeen = now;
            // Un hecho aportado por un humano no se sobreescribe con una inferencia.
            if (existing.source !== "human") {
                existing.answer = incoming.answer;
            }
            continue;
        }

        knowledge.facts.push({
            id: nextId(knowledge.facts, "F"),
            question: incoming.question,
            answer: incoming.answer,
            area: incoming.area || "general",
            source: "human",
            firstSeen: now,
            lastSeen: now,
            sessions: [sessionKey],
        });
        outcome.newFacts++;
    }

    for (const ruleId of distilled.violatedRules) {
        const rule = knowledge.rules.find((item) => item.id === ruleId);
        if (rule) rule.violationsAfterLearning++;
    }

    return outcome;
}

/** Dos textos dicen lo mismo si comparten la mayoria de sus palabras significativas. */
function similar(a: string, b: string): boolean {
    const left = keywords(a);
    const right = keywords(b);
    if (left.length === 0 || right.length === 0) return false;

    const shared = left.filter((word) => right.includes(word)).length;
    return shared / Math.min(left.length, right.length) >= 0.7;
}

function nextId(items: Array<{ id: string }>, prefix: string): string {
    const max = items.reduce((highest, item) => {
        const parsed = Number(item.id.replace(`${prefix}-`, ""));
        return Number.isFinite(parsed) && parsed > highest ? parsed : highest;
    }, 0);

    return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Estadisticas
// ---------------------------------------------------------------------------

export function updateStats(
    knowledge: KnowledgeBase,
    specsGenerated: number,
    specsPassedFirstTry: number,
    repairAttempts: number
): void {
    const stats = knowledge.stats;
    stats.sessions++;
    stats.specsGenerated += specsGenerated;
    stats.specsPassedFirstTry += specsPassedFirstTry;
    stats.totalRepairAttempts += repairAttempts;
    stats.averageRepairAttempts =
        stats.specsGenerated > 0
            ? Number((stats.totalRepairAttempts / stats.specsGenerated).toFixed(2))
            : 0;
}

// ---------------------------------------------------------------------------
// Vista legible
// ---------------------------------------------------------------------------

/**
 * KNOWLEDGE.md se regenera desde el .json en cada corrida: es para leer y
 * revisar en un PR. Para editar a mano, se toca el .json.
 */
export function renderKnowledgeMarkdown(knowledge: KnowledgeBase): string {
    const stats = knowledge.stats;
    const firstTryRate =
        stats.specsGenerated > 0
            ? ((stats.specsPassedFirstTry / stats.specsGenerated) * 100).toFixed(0)
            : "0";

    const lines: string[] = [
        "# Base de conocimiento del Agente AQA",
        "",
        "> Generado automaticamente desde `knowledge-base.json`. **No edites este archivo**:",
        "> los cambios se pierden en la siguiente corrida. Edita el `.json` y se regenera.",
        "",
        `Actualizado: ${knowledge.updatedAt}`,
        "",
        "## Salud del aprendizaje",
        "",
        "| Metrica | Valor |",
        "| --- | --- |",
        `| Sesiones registradas | ${stats.sessions} |`,
        `| Specs generados | ${stats.specsGenerated} |`,
        `| Specs que pasaron sin reparacion | ${stats.specsPassedFirstTry} (${firstTryRate}%) |`,
        `| Promedio de intentos de reparacion | ${stats.averageRepairAttempts} |`,
        `| Preguntas evitadas por hechos conocidos | ${stats.questionsAvoidedByFacts} |`,
        `| Reglas / Recetas / Hechos | ${knowledge.rules.length} / ${knowledge.recipes.length} / ${knowledge.facts.length} |`,
        "",
        "Si el promedio de reparaciones no baja con las sesiones, las reglas estan mal",
        "redactadas o no se estan respetando: revisa la columna de incumplimientos.",
        "",
    ];

    lines.push("## Reglas", "");
    if (knowledge.rules.length === 0) {
        lines.push("_Todavia no hay reglas aprendidas._", "");
    } else {
        for (const scope of ["both", "ui", "api"] as const) {
            const rules = knowledge.rules.filter((rule) => rule.scope === scope);
            if (rules.length === 0) continue;

            lines.push(`### ${SCOPE_LABEL[scope]}`, "");
            lines.push(
                "| ID | Regla | Cuando aplica | Origen | Confirmada | Incumplida despues |",
                "| --- | --- | --- | --- | --- | --- |"
            );
            for (const rule of rules.sort((a, b) => score(b) - score(a))) {
                lines.push(
                    `| ${rule.id} | ${cell(rule.rule)} | ${cell(rule.trigger)} | ${ORIGIN_LABEL[rule.origin]} | ${rule.confirmations}x | ${rule.violationsAfterLearning}x |`
                );
            }
            lines.push("");
        }
    }

    lines.push("## Soluciones verificadas", "");
    if (knowledge.recipes.length === 0) {
        lines.push("_Todavia no hay soluciones registradas._", "");
    } else {
        for (const recipe of knowledge.recipes) {
            lines.push(
                `### ${recipe.id} - ${recipe.problem}`,
                "",
                `- **Aplica a:** ${SCOPE_LABEL[recipe.scope]}`,
                `- **Va en:** \`${recipe.placement}\``,
                `- **Confirmada:** ${recipe.confirmations}x`,
                "",
                "```typescript",
                recipe.code.trim(),
                "```",
                ""
            );
        }
    }

    lines.push(
        "## Hechos del dominio",
        "",
        "Datos que el agente no puede deducir del codigo. Cada uno evita una pregunta al QA",
        "en las siguientes corridas.",
        ""
    );
    if (knowledge.facts.length === 0) {
        lines.push("_Todavia no hay hechos registrados._", "");
    } else {
        lines.push(
            "| Area | Pregunta que responde | Dato | Origen |",
            "| --- | --- | --- | --- |"
        );
        for (const fact of [...knowledge.facts].sort((a, b) => a.area.localeCompare(b.area))) {
            lines.push(
                `| ${cell(fact.area)} | ${cell(fact.question)} | ${cell(fact.answer)} | ${fact.source === "human" ? "QA" : "inferido"} |`
            );
        }
        lines.push("");
    }

    lines.push("## Historial de sesiones", "");
    if (knowledge.history.length === 0) {
        lines.push("_Sin sesiones registradas._", "");
    } else {
        lines.push(
            "| Fecha | Sesion | Specs | Sin reparar | Nuevas reglas | Recetas | Hechos |",
            "| --- | --- | --- | --- | --- | --- | --- |"
        );
        for (const entry of [...knowledge.history].reverse()) {
            lines.push(
                `| ${entry.date.slice(0, 10)} | ${entry.sessionKey} | ${entry.specsGenerated} | ${entry.specsPassedFirstTry} | ${entry.newRules} | ${entry.newRecipes} | ${entry.newFacts} |`
            );
        }
        lines.push("");
    }

    lines.push(
        "## Como mantener esta base",
        "",
        "- **Borrar una leccion mala:** quita su entrada del `.json` y commitea.",
        "- **Corregir la redaccion:** editala en el `.json`; se conserva su historial.",
        "- **Agregar conocimiento a mano:** copia una entrada existente, ponle un id nuevo",
        "  y `\"origin\": \"seed\"` (reglas) o `\"source\": \"human\"` (hechos).",
        "- **Reglas con muchos incumplimientos:** senal de que estan ambiguas. Reescribelas",
        "  en imperativo y con un trigger concreto.",
        "- **Nunca** guardes contrasenas, tokens ni secretos aqui: este archivo va al repo.",
        ""
    );

    return lines.join("\n");
}

const SCOPE_LABEL: Record<KnowledgeScope, string> = {
    both: "Todos los tests",
    ui: "Tests de UI",
    api: "Tests de API",
};

const ORIGIN_LABEL: Record<KnowledgeRule["origin"], string> = {
    repair: "reparacion",
    human: "QA",
    "coverage-gap": "cobertura",
    seed: "manual",
};

function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim() || "-";
}

/** Resumen corto para imprimir al cerrar la corrida. */
export function describeSessionLearning(summary: SessionLearningSummary): string[] {
    const lines = [
        `aprendizaje: ${summary.newRules} regla(s) nueva(s), ${summary.newRecipes} receta(s), ${summary.newFacts} hecho(s)`,
    ];

    if (summary.confirmedRules > 0) {
        lines.push(`${summary.confirmedRules} regla(s) ya conocida(s) reconfirmada(s)`);
    }
    if (summary.violatedRules.length > 0) {
        lines.push(
            `! ${summary.violatedRules.length} regla(s) aprendida(s) fueron incumplidas: ${summary.violatedRules.join(", ")}`
        );
    }
    if (summary.notes) {
        lines.push(`nota: ${summary.notes}`);
    }

    return lines;
}
