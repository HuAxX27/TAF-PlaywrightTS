import * as readline from "readline";
import { agentConfig } from "../config";
import type { RunOptions } from "../pipeline";
import { discoverCandidates, promoteCandidates, type CandidateInfo } from "./promotion";

type WizardAction = { kind: "run"; options: RunOptions } | { kind: "done" };

/** Pantalla inicial para quien no conoce flags ni estructura de carpetas. */
export async function runMainWizard(): Promise<WizardAction> {
    const terminal = createTerminal();
    try {
        console.log("\nAgente AQA\n");
        console.log("  1. Generar pruebas desde Xray");
        console.log("  2. Ver estado de candidates");
        console.log("  3. Promover candidates listos");
        console.log("  4. Salir\n");

        for (;;) {
            const selected = await terminal.ask("Selecciona una opcion [1-4]: ");
            if (selected === "1") {
                return { kind: "run", options: await askGenerationOptions(terminal) };
            }
            if (selected === "2") {
                printCandidates(discoverCandidates());
                return { kind: "done" };
            }
            if (selected === "3") {
                await promoteInteractively(terminal);
                return { kind: "done" };
            }
            if (selected === "4" || selected.toLowerCase() === "q") {
                return { kind: "done" };
            }
            console.log("Opcion no reconocida. Escribe 1, 2, 3 o 4.");
        }
    } finally {
        terminal.close();
    }
}

/** Entrada directa de `npm run promote`. */
export async function runPromotionWizard(): Promise<void> {
    const candidates = discoverCandidates();
    if (process.stdin.isTTY !== true) {
        printCandidates(candidates);
        if (!candidates.some((candidate) => candidate.eligible)) {
            console.log("\nNo hay candidates listos para promover.");
            return;
        }
        console.log("\nAbre este comando en una terminal interactiva para seleccionar candidates.");
        return;
    }

    const terminal = createTerminal();
    try {
        await promoteInteractively(terminal, candidates);
    } finally {
        terminal.close();
    }
}

export function printCandidateStatus(): void {
    printCandidates(discoverCandidates());
}

async function askGenerationOptions(terminal: Terminal): Promise<RunOptions> {
    console.log("\n¿Que deseas importar de Xray?\n");
    console.log("  1. Un Test Case");
    console.log("  2. Varios Test Cases por clave");
    console.log("  3. Todos los Tests de un Test Plan");
    console.log("  4. Tests encontrados mediante JQL\n");

    for (;;) {
        const selected = await terminal.ask("Selecciona el origen [1-4]: ");
        if (selected === "1") {
            const key = await terminal.askRequired("Clave Xray (ej. PROJ-123): ");
            return options(key);
        }
        if (selected === "2") {
            const raw = await terminal.askRequired(
                "Claves separadas por coma o espacio (ej. PROJ-123, PROJ-124): "
            );
            const keys = raw
                .split(/[\s,]+/)
                .map((key) => key.trim())
                .filter(Boolean);
            if (keys.length === 0) {
                console.log("No se encontro ninguna clave.");
                continue;
            }
            return options(`keys:${keys.join(",")}`);
        }
        if (selected === "3") {
            const key = await terminal.askRequired("Clave del Test Plan: ");
            return options(`plan:${key}`);
        }
        if (selected === "4") {
            const jql = await terminal.askRequired("Consulta JQL: ");
            return options(`jql:${jql}`);
        }
        console.log("Opcion no reconocida. Escribe 1, 2, 3 o 4.");
    }
}

function options(selector: string): RunOptions {
    console.log(`\nProveedor configurado: ${agentConfig.provider}`);
    return { selector, provider: agentConfig.provider };
}

async function promoteInteractively(
    terminal: Terminal,
    candidates = discoverCandidates()
): Promise<void> {
    printCandidates(candidates);
    const ready = candidates.filter((candidate) => candidate.eligible);
    if (ready.length === 0) {
        console.log(
            "\nNo hay candidates listos para promover. Corrige primero los que aparecen bloqueados."
        );
        return;
    }

    console.log("\nCandidates promovibles:\n");
    ready.forEach((candidate, index) => {
        console.log(`  ${index + 1}. ${candidate.testCaseId}  ${candidate.relativePath}`);
    });
    console.log("\nEscribe numeros separados por coma, un rango (1-3), o 'todos'.");

    for (;;) {
        const raw = await terminal.ask("Seleccion: ");
        let indexes: number[];
        try {
            indexes = parseSelection(raw, ready.length);
        } catch (error) {
            console.log((error as Error).message);
            continue;
        }

        const selected = indexes.map((index) => ready[index]);
        console.log("\nSe promoveran:");
        selected.forEach((candidate) => console.log(`  - ${candidate.relativePath}`));
        const confirmation = (await terminal.ask("\nConfirmar promocion [s/N]: "))
            .trim()
            .toLowerCase();
        if (!isYes(confirmation)) {
            console.log("Promocion cancelada; no se movio ningun archivo.");
            return;
        }

        const promoted = promoteCandidates(selected.map((candidate) => candidate.relativePath));
        console.log(`\n${promoted.length} candidate(s) promovido(s):`);
        promoted.forEach((item) => console.log(`  - ${item.testCaseId}: ${item.target}`));
        return;
    }
}

function printCandidates(candidates: CandidateInfo[]): void {
    console.log("\nEstado de candidates\n");
    if (candidates.length === 0) {
        console.log("  No hay candidates generados.");
        return;
    }

    for (const candidate of candidates) {
        const label = candidate.eligible ? "LISTO" : "BLOQUEADO";
        console.log(`  [${label}] ${candidate.testCaseId}  ${candidate.relativePath}`);
        if (candidate.reason) console.log(`             ${candidate.reason}`);
    }
}

function parseSelection(raw: string, size: number): number[] {
    const value = raw.trim().toLowerCase();
    if (value === "todos" || value === "all" || value === "*") {
        return Array.from({ length: size }, (_, index) => index);
    }

    const selected = new Set<number>();
    for (const part of value.split(",").map((item) => item.trim())) {
        if (!part) continue;
        const range = part.match(/^(\d+)-(\d+)$/);
        if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            if (start > end) throw new Error(`Rango invalido: ${part}`);
            for (let current = start; current <= end; current++) {
                addSelection(selected, current, size);
            }
            continue;
        }
        if (!/^\d+$/.test(part)) throw new Error(`Seleccion invalida: ${part || raw}`);
        addSelection(selected, Number(part), size);
    }

    if (selected.size === 0) throw new Error("Selecciona al menos un candidate.");
    return [...selected].sort((left, right) => left - right);
}

function addSelection(selected: Set<number>, value: number, size: number): void {
    if (value < 1 || value > size) {
        throw new Error(`El numero ${value} no existe en la lista.`);
    }
    selected.add(value - 1);
}

function isYes(value: string): boolean {
    return value === "s" || value === "si" || value === "y" || value === "yes";
}

interface Terminal {
    ask(question: string): Promise<string>;
    askRequired(question: string): Promise<string>;
    close(): void;
}

function createTerminal(): Terminal {
    const ui = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (question: string) =>
        new Promise<string>((resolve) => ui.question(question, (answer) => resolve(answer.trim())));

    return {
        ask,
        async askRequired(question: string): Promise<string> {
            for (;;) {
                const answer = await ask(question);
                if (answer.length > 0) return answer;
                console.log("Este dato es obligatorio.");
            }
        },
        close: () => ui.close(),
    };
}
