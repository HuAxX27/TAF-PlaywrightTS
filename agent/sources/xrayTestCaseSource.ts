import type { TestCase, TestPriority } from "../types";
import type { TestCaseSource } from "./testCaseSource";

export interface XrayOptions {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    timeoutMs: number;
}

interface XrayStep {
    action?: string;
    data?: string;
    result?: string;
}

interface XrayTestNode {
    issueId: string;
    testType?: { name?: string };
    steps?: XrayStep[];
    jira: {
        key?: string;
        summary?: string;
        priority?: { name?: string };
        labels?: string[];
    };
}

interface GetTestsResponse {
    data?: { getTests?: { results?: XrayTestNode[] } };
    errors?: Array<{ message?: string }>;
}

const PRIORITY_MAP: Record<string, TestPriority> = {
    highest: "critical",
    high: "high",
    medium: "medium",
    low: "low",
    lowest: "low",
};

/**
 * Trae Test issues YA definidos en Xray Cloud (pasos manuales incluidos) via su
 * API GraphQL. Xray guarda los pasos fuera de los campos estandar de Jira, por
 * eso la API REST de Jira sola no basta (a diferencia de una User Story normal,
 * ver `jiraSource.ts`).
 */
export class XrayTestCaseSource implements TestCaseSource {
    readonly name = "xray";
    private token: string | undefined;

    constructor(private readonly options: XrayOptions) {}

    static fromEnv(timeoutMs: number): XrayTestCaseSource {
        const clientId = process.env.XRAY_CLIENT_ID?.trim();
        const clientSecret = process.env.XRAY_CLIENT_SECRET?.trim();

        if (!clientId || !clientSecret) {
            throw new Error(
                "Faltan XRAY_CLIENT_ID o XRAY_CLIENT_SECRET en el .env. " +
                    "Generalos en Xray > Settings globales > API Keys, o usa --source=file " +
                    "con agent/testcases/<CLAVE>.json mientras tanto."
            );
        }

        return new XrayTestCaseSource({
            baseUrl: process.env.XRAY_BASE_URL?.trim() || "https://xray.cloud.getxray.app",
            clientId,
            clientSecret,
            timeoutMs,
        });
    }

    async fetch(key: string): Promise<TestCase[]> {
        const token = await this.authenticate();
        const query = `query {
            getTests(jql: "key = ${escapeJql(key)}", limit: 10) {
                results {
                    issueId
                    testType { name }
                    steps { action data result }
                    jira(fields: ["key", "summary", "priority", "labels"])
                }
            }
        }`;

        const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, "")}/api/v2/graphql`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ query }),
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (!response.ok) {
            throw new Error(
                `Xray respondio ${response.status} al pedir ${key}: ${(await response.text()).slice(0, 300)}`
            );
        }

        const payload = (await response.json()) as GetTestsResponse;
        if (payload.errors?.length) {
            throw new Error(
                `Xray devolvio errores para ${key}: ${payload.errors.map((error) => error.message).join("; ")}`
            );
        }

        const results = payload.data?.getTests?.results ?? [];
        if (results.length === 0) {
            throw new Error(`Xray no encontro ningun Test para "${key}".`);
        }

        return results.map(toTestCase);
    }

    private async authenticate(): Promise<string> {
        if (this.token) return this.token;

        const response = await fetch(`${this.options.baseUrl.replace(/\/+$/, "")}/api/v2/authenticate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                client_id: this.options.clientId,
                client_secret: this.options.clientSecret,
            }),
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (!response.ok) {
            throw new Error(
                `Xray rechazo la autenticacion (${response.status}): ${(await response.text()).slice(0, 300)}`
            );
        }

        // El endpoint devuelve el JWT como un string JSON (con comillas incluidas).
        const raw = await response.text();
        this.token = raw.replace(/^"|"$/g, "");
        return this.token;
    }
}

function toTestCase(node: XrayTestNode): TestCase {
    const key = node.jira.key ?? node.issueId;
    const priorityName = node.jira.priority?.name?.toLowerCase();
    const labels = node.jira.labels ?? [];
    const steps = node.steps ?? [];

    return {
        id: key,
        title: node.jira.summary ?? key,
        level: "e2e",
        priority: (priorityName && PRIORITY_MAP[priorityName]) || "medium",
        tags: labels.map((label) => `@${label}`),
        preconditions: [],
        steps: steps
            .map((step) => [step.action, step.data].filter(Boolean).join(" - "))
            .filter(Boolean),
        expectedResult: steps
            .map((step) => step.result)
            .filter(Boolean)
            .join(" | "),
        automatable: true,
    };
}

/** Evita que una clave con comillas rompa la consulta JQL embebida. */
function escapeJql(value: string): string {
    return value.replace(/"/g, '\\"');
}
