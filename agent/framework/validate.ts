import * as path from "path";
import { agentConfig } from "../config";
import { run } from "./shell";

export interface FileValidation {
    ok: boolean;
    errors: string[];
}

/**
 * Puerta de calidad sobre el codigo generado.
 *
 * Sin esto el agente solo "escribe archivos": nada garantiza que compilen ni que
 * Playwright los reconozca. Los errores que devuelve se le regresan al modelo
 * para que repare, que es lo que convierte la generacion en algo utilizable.
 */
export function validateGeneratedFile(filePath: string): FileValidation {
    return validateGeneratedFiles(filePath, []);
}

/** Igual que `validateGeneratedFile`, pero tambien valida los archivos de soporte tocados. */
export function validateGeneratedFiles(specPath: string, supportPaths: string[]): FileValidation {
    const specRel = toRelative(specPath);
    const supportRels = supportPaths.map(toRelative);
    const allRels = [specRel, ...supportRels];
    const errors: string[] = [];

    // 1. Playwright puede cargar el spec y ve al menos una prueba.
    const list = run(`npx playwright test --list "${specRel}" --reporter=list`, {
        cwd: agentConfig.root,
    });
    if (list.code !== 0) {
        errors.push(...meaningfulLines(`${list.stdout}\n${list.stderr}`).slice(0, 25));
    } else if (/found 0 tests|No tests found/i.test(`${list.stdout}${list.stderr}`)) {
        errors.push("Playwright cargo el archivo pero no encontro ninguna prueba declarada.");
    }

    // 2. Compila en modo strict (afecta a todo el proyecto: si un Page Object nuevo
    // rompe otro spec existente, se detecta aqui).
    const typecheck = run("npx tsc --noEmit", { cwd: agentConfig.root });
    if (typecheck.code !== 0) {
        const own = `${typecheck.stdout}\n${typecheck.stderr}`
            .split(/\r?\n/)
            .filter((line) => allRels.some((rel) => line.replace(/\\/g, "/").includes(rel)));
        errors.push(...own.slice(0, 25));
    }

    // 3. Lint: no bloquea si el linter mismo no puede correr.
    const lint = run(`npx eslint ${allRels.map((rel) => `"${rel}"`).join(" ")}`, {
        cwd: agentConfig.root,
    });
    if (lint.code !== 0 && /error/i.test(lint.stdout)) {
        errors.push(...meaningfulLines(lint.stdout).slice(0, 15));
    }

    return { ok: errors.length === 0, errors };
}

function toRelative(filePath: string): string {
    return path.relative(agentConfig.root, filePath).replace(/\\/g, "/");
}

function meaningfulLines(output: string): string[] {
    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !/^\s*at\s/.test(line));
}
