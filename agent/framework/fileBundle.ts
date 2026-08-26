import * as path from "path";

/** Únicas carpetas donde los agentes pueden crear o modificar soporte. */
const ALLOWED_SUPPORT_PREFIXES = [
    "src/pages/",
    "src/components/",
    "src/api/",
    "src/data/",
    "src/fixtures/",
] as const;

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
