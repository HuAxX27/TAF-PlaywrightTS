import * as readline from "readline";
import { agentConfig } from "../config";
import type { AnsweredQuestion, OpenQuestion } from "../types";

/**
 * Canal de interaccion con el humano.
 *
 * El agente no adivina: cuando algo queda ambiguo pregunta, y no cierra el
 * proceso hasta que el humano aprueba. En modo no interactivo (CI, --yes) se
 * aceptan los supuestos declarados por el agente y se aprueba automaticamente,
 * de modo que el pipeline sigue siendo scriptable.
 */

let rl: readline.Interface | undefined;

/**
 * Sin TTY no hay a quien preguntar (stdin redirigido, CI, pipe): preguntar ahi
 * dejaria el proceso colgado para siempre.
 */
export function isInteractive(): boolean {
    return agentConfig.interactive && process.stdin.isTTY === true;
}

function ui(): readline.Interface {
    if (!rl) {
        rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    }
    return rl;
}

/** Cierra el stdin: sin esto el proceso queda colgado al terminar el pipeline. */
export function closeHumanChannel(): void {
    rl?.close();
    rl = undefined;
}

async function prompt(question: string): Promise<string> {
    return new Promise((resolve) => ui().question(question, (answer) => resolve(answer)));
}

export interface AskResult {
    answers: AnsweredQuestion[];
    /** true si el humano contesto al menos una pregunta (hay input nuevo que aplicar). */
    hasNewInput: boolean;
}

/**
 * Presenta las dudas del agente y recoge las respuestas. Enter vacio = aceptar
 * el supuesto que el agente propuso, y queda registrado como tal.
 */
export async function askOpenQuestions(questions: OpenQuestion[]): Promise<AskResult> {
    if (questions.length === 0) {
        return { answers: [], hasNewInput: false };
    }

    if (!isInteractive()) {
        console.log(
            `\n  ! ${questions.length} duda(s) detectada(s); modo no interactivo: se aceptan los supuestos del agente.`
        );
        for (const question of questions) {
            console.log(`    - ${question.question}`);
            console.log(`      supuesto: ${question.assumptionIfUnanswered}`);
        }
        return {
            answers: questions.map((question) => ({
                ...question,
                answer: question.assumptionIfUnanswered,
                answeredByHuman: false,
            })),
            hasNewInput: false,
        };
    }

    console.log(
        `\n  El agente tiene ${questions.length} duda(s). Responde para evitar supuestos.` +
            `\n  (Enter vacio = aceptar el supuesto propuesto)\n`
    );

    const answers: AnsweredQuestion[] = [];
    let hasNewInput = false;

    for (const [index, question] of questions.entries()) {
        console.log(`  [${index + 1}/${questions.length}] ${question.question}`);
        console.log(`      por que importa: ${question.why}`);
        console.log(`      si no respondes: ${question.assumptionIfUnanswered}`);
        if (question.relatedTestCaseIds.length > 0) {
            console.log(`      afecta a: ${question.relatedTestCaseIds.join(", ")}`);
        }

        const raw = (await prompt("      > ")).trim();
        const answeredByHuman = raw.length > 0;
        if (answeredByHuman) hasNewInput = true;

        answers.push({
            ...question,
            answer: answeredByHuman ? raw : question.assumptionIfUnanswered,
            answeredByHuman,
        });
        console.log("");
    }

    return { answers, hasNewInput };
}

export type ApprovalDecision =
    | { action: "approve" }
    | { action: "revise"; feedback: string }
    | { action: "abort" };

/**
 * Puerta de aprobacion. El pipeline no avanza hasta que el humano dice que
 * si, o pide cambios describiendo que corregir.
 */
export async function requestApproval(title: string, summary: string[]): Promise<ApprovalDecision> {
    console.log(`\n  ${title}`);
    for (const line of summary) {
        console.log(`    ${line}`);
    }

    if (!isInteractive()) {
        console.log("    modo no interactivo: se aprueba automaticamente.");
        return { action: "approve" };
    }

    for (;;) {
        const raw = (
            await prompt("\n  Aprobar? [s]i / [c]ambios / [a]bortar: ")
        )
            .trim()
            .toLowerCase();

        if (raw === "s" || raw === "si" || raw === "y" || raw === "yes") {
            return { action: "approve" };
        }
        if (raw === "a" || raw === "abortar" || raw === "abort") {
            return { action: "abort" };
        }
        if (raw === "c" || raw === "cambios") {
            const feedback = (
                await prompt("  Describe que hay que cambiar (una linea): ")
            ).trim();
            if (feedback.length > 0) {
                return { action: "revise", feedback };
            }
            console.log("  ! Sin descripcion no puedo cambiar nada. Intenta de nuevo.");
            continue;
        }
        console.log("  ! Opcion no reconocida.");
    }
}

/** Confirmacion puntual (p.ej. aceptar un veredicto de cobertura incompleto). */
export async function confirm(question: string, defaultValue: boolean): Promise<boolean> {
    if (!isInteractive()) return defaultValue;

    const raw = (await prompt(`  ${question} [${defaultValue ? "S/n" : "s/N"}]: `))
        .trim()
        .toLowerCase();

    if (raw === "") return defaultValue;
    return raw === "s" || raw === "si" || raw === "y" || raw === "yes";
}

/** Permite al humano corregir la clasificacion UI/API antes de generar codigo. */
export async function askKindOverride(
    testCaseId: string,
    title: string,
    detected: "ui" | "api",
    rationale: string
): Promise<"ui" | "api"> {
    if (!isInteractive()) return detected;

    console.log(`\n  ${testCaseId} "${title}"`);
    console.log(`    clasificado como: ${detected.toUpperCase()} (${rationale})`);

    const raw = (await prompt("    Enter para aceptar, o escribe ui / api: ")).trim().toLowerCase();
    return raw === "ui" || raw === "api" ? raw : detected;
}
