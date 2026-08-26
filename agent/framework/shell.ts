import { spawnSync } from "child_process";
import * as path from "path";

interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

interface RunOptions {
    cwd: string;
    timeoutMs?: number;
    env?: Record<string, string>;
}

type NodeTool = "eslint" | "playwright" | "typescript";

const TOOL_ENTRYPOINT: Record<NodeTool, string> = {
    eslint: path.join(path.dirname(require.resolve("eslint/package.json")), "bin", "eslint.js"),
    playwright: require.resolve("@playwright/test/cli"),
    typescript: require.resolve("typescript/bin/tsc"),
};

/** Ejecuta una herramienta instalada mediante Node, sin shell ni resolución de PATH. */
export function runTool(tool: NodeTool, args: string[], options: RunOptions): CommandResult {
    const result = spawnSync(process.execPath, [TOOL_ENTRYPOINT[tool], ...args], {
        cwd: options.cwd,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
        timeout: options.timeoutMs ?? 300_000,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        shell: false,
    });

    return {
        code: result.status ?? (result.error ? 1 : 0),
        stdout: result.stdout ?? "",
        stderr: result.stderr || result.error?.message || "",
    };
}
