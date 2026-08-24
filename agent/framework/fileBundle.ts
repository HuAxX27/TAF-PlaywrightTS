import * as path from "path";

export interface FileEntry {
    /** Ruta relativa a la raiz del repo, con "/" (ej. "src/pages/LoginPage.ts"). */
    path: string;
    content: string;
}

export interface FileBundle {
    specContent: string;
    supportFiles: FileEntry[];
}

/** Unicas carpetas donde el LLM puede crear o modificar archivos de soporte. */
export const ALLOWED_SUPPORT_PREFIXES = [
    "src/pages/",
    "src/components/",
    "src/api/",
    "src/data/",
    "src/fixtures/",
] as const;

const FILE_BLOCK = /FILE:\s*(.+?)\r?\n```(?:\w+)?\r?\n([\s\S]*?)```/g;

/**
 * Parsea la respuesta del LLM en bloques `FILE: <ruta>` + \`\`\`. Este formato
 * evita el escapado de comillas/backticks que un JSON con codigo TS adentro
 * volveria fragil.
 */
export function parseFileBundle(raw: string, specRelPath: string): FileBundle {
    const blocks: FileEntry[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(FILE_BLOCK);

    while ((match = regex.exec(raw)) !== null) {
        const rawPath = match[1].trim().replace(/^["'`]|["'`]$/g, "");
        blocks.push({ path: normalizeRelPath(rawPath), content: match[2].trim() });
    }

    const normalizedSpecPath = normalizeRelPath(specRelPath);
    const specBlock = blocks.find((block) => block.path === normalizedSpecPath);

    // Compatibilidad: si el modelo no respeto el formato FILE:, se asume que
    // toda la respuesta es el spec (comportamiento previo de un solo archivo).
    if (!specBlock) {
        return { specContent: stripFences(raw), supportFiles: [] };
    }

    const supportFiles = blocks
        .filter((block) => block.path !== normalizedSpecPath)
        .filter((block) => isAllowedSupportPath(block.path));

    return { specContent: specBlock.content, supportFiles };
}

/** Solo rutas dentro de las carpetas permitidas, sin escapar del repo. */
export function isAllowedSupportPath(relPath: string): boolean {
    if (path.isAbsolute(relPath)) return false;

    // `startsWith("src/pages/")` no basta: `src/pages/../../package.json`
    // tambien lo cumple. Normalizamos primero y rechazamos todo escape del arbol.
    const normalized = path.posix.normalize(normalizeRelPath(relPath));
    if (
        !normalized ||
        normalized === "." ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized.includes("\0")
    ) {
        return false;
    }
    // Tambien protege los comandos de validacion: los nombres de archivo no
    // pueden introducir comillas, operadores de shell ni extensiones ejecutables.
    const segments = normalized.split("/");
    if (
        !normalized.endsWith(".ts") ||
        !segments.every((segment) => /^[A-Za-z0-9._-]+$/.test(segment))
    ) {
        return false;
    }
    return ALLOWED_SUPPORT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function normalizeRelPath(relPath: string): string {
    return relPath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripFences(raw: string): string {
    const fenced = raw.match(/```(?:ts|typescript|javascript)?\s*([\s\S]*?)```/);
    return (fenced ? fenced[1] : raw).trim();
}
