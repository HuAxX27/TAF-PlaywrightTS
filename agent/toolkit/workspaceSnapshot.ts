import { execFileSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { agentConfig } from "../config";

interface WorkspaceSnapshot {
    schemaVersion: 1;
    recordedAt: string;
    files: Record<string, string>;
}

export function captureWorkspaceSnapshot(): WorkspaceSnapshot {
    const output = execFileSync(
        "git",
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        { cwd: agentConfig.root, encoding: "utf-8" }
    );
    const files: Record<string, string> = {};

    for (const rawPath of output.split("\0").filter(Boolean).sort()) {
        const relativePath = normalize(rawPath);
        if (excluded(relativePath)) continue;
        const absolutePath = path.join(agentConfig.root, relativePath);
        if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) continue;
        files[relativePath] = createHash("sha256")
            .update(fs.readFileSync(absolutePath))
            .digest("hex");
    }

    return {
        schemaVersion: 1,
        recordedAt: new Date().toISOString(),
        files,
    };
}

export function changesSinceSnapshot(snapshotPath: string): string[] {
    if (!fs.existsSync(snapshotPath)) {
        throw new Error(`Falta la instantanea de workspace: ${snapshotPath}`);
    }
    const baseline = JSON.parse(
        fs.readFileSync(snapshotPath, "utf-8")
    ) as Partial<WorkspaceSnapshot>;
    if (baseline.schemaVersion !== 1 || !baseline.files) {
        throw new Error(`Instantanea de workspace invalida: ${snapshotPath}`);
    }
    const current = captureWorkspaceSnapshot().files;
    const allPaths = new Set([...Object.keys(baseline.files), ...Object.keys(current)]);
    return [...allPaths]
        .filter((filePath) => baseline.files?.[filePath] !== current[filePath])
        .sort();
}

export function isCandidateSpecPath(relativePath: string): boolean {
    const normalized = normalize(relativePath);
    const candidateRoot = `${normalize(path.relative(agentConfig.root, agentConfig.candidatesDir))}/`;
    return normalized.startsWith(candidateRoot) && normalized.endsWith(".spec.ts");
}

function excluded(relativePath: string): boolean {
    const normalized = normalize(relativePath);
    return [
        "agent/artifacts/",
        "node_modules/",
        "playwright-report/",
        "test-results/",
        ".auth/",
        "playwright/.auth/",
    ].some((prefix) => normalized.startsWith(prefix));
}

function normalize(value: string): string {
    return value.trim().replace(/\\/g, "/");
}
