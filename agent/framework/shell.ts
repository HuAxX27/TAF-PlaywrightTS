import { execSync } from "child_process";

export interface CommandResult {
    code: number;
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    cwd: string;
    timeoutMs?: number;
    env?: Record<string, string>;
}

/** Ejecuta un comando y devuelve su salida sin lanzar excepcion en fallo. */
export function run(command: string, options: RunOptions): CommandResult {
    try {
        const stdout = execSync(command, {
            cwd: options.cwd,
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "pipe"],
            maxBuffer: 32 * 1024 * 1024,
            timeout: options.timeoutMs ?? 300_000,
            env: options.env ? { ...process.env, ...options.env } : process.env,
        });
        return { code: 0, stdout, stderr: "" };
    } catch (error) {
        const failure = error as {
            status?: number;
            stdout?: string | Buffer;
            stderr?: string | Buffer;
            message?: string;
        };
        return {
            code: failure.status ?? 1,
            stdout: String(failure.stdout ?? ""),
            stderr: String(failure.stderr ?? failure.message ?? ""),
        };
    }
}
