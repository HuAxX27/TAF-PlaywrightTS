import * as path from "path";
import * as fs from "fs";
import { agentConfig } from "../config";
import { runTool } from "./shell";

interface FileValidation {
    ok: boolean;
    errors: string[];
}

/** Puerta determinista sobre el spec y todos los archivos de soporte tocados. */
export function validateGeneratedFiles(specPath: string, supportPaths: string[]): FileValidation {
    const specRel = toRelative(specPath);
    const supportRels = supportPaths.map(toRelative);
    const allRels = [specRel, ...supportRels];
    const errors: string[] = [];

    // Un candidate con placeholders puede compilar y hasta pasar, pero no es un
    // test automatizado utilizable. Esta puerta es determinista, no generativa.
    for (const filePath of [specPath, ...supportPaths]) {
        const content = fs.readFileSync(filePath, "utf-8");
        if (/\bTODO\b|\bPENDIENTE\b|test\.fixme\s*\(|waitForTimeout\s*\(/i.test(content)) {
            errors.push(
                `${toRelative(filePath)} contiene TODO/PENDIENTE/test.fixme/waitForTimeout.`
            );
        }
    }

    // 1. Playwright puede cargar el spec y ve al menos una prueba.
    const list = runTool("playwright", ["test", "--list", specRel, "--reporter=list"], {
        cwd: agentConfig.root,
        env: { AQA_INCLUDE_CANDIDATES: "true" },
    });
    if (list.code !== 0) {
        errors.push(...meaningfulLines(`${list.stdout}\n${list.stderr}`).slice(0, 25));
    } else if (/found 0 tests|No tests found/i.test(`${list.stdout}${list.stderr}`)) {
        errors.push("Playwright cargo el archivo pero no encontro ninguna prueba declarada.");
    }

    // 2. Compila en modo strict (afecta a todo el proyecto: si un Page Object nuevo
    // rompe otro spec existente, se detecta aqui).
    const typecheck = runTool("typescript", ["--noEmit"], { cwd: agentConfig.root });
    if (typecheck.code !== 0) {
        const output = `${typecheck.stdout}\n${typecheck.stderr}`;
        const own = output
            .split(/\r?\n/)
            .filter((line) => allRels.some((rel) => line.replace(/\\/g, "/").includes(rel)));
        // Si un cambio de soporte rompe un consumidor existente, el error puede
        // estar en otro archivo. Un tsc rojo nunca puede convertirse en OK.
        errors.push(...(own.length > 0 ? own : meaningfulLines(output)).slice(0, 25));
    }

    // 3. Lint: no bloquea si el linter mismo no puede correr.
    const lint = runTool("eslint", allRels, { cwd: agentConfig.root });
    if (lint.code !== 0) {
        errors.push(...meaningfulLines(`${lint.stdout}\n${lint.stderr}`).slice(0, 15));
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
