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
    data?: {
        getTests?: { results?: XrayTestNode[] };
        getTestPlan?: { tests?: { results?: XrayTestNode[] } };
        getTestPlans?: { results?: Array<{ tests?: { results?: XrayTestNode[] } }> };
    };
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
 * eso la API REST de Jira sola no basta. Tambien admite lotes por JQL, claves
 * explicitas o Test Plan.
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

    async fetch(selector: string): Promise<TestCase[]> {
        const token = await this.authenticate();
        const query = queryFor(selector);

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
                `Xray respondio ${response.status} al pedir ${selector}: ${(await response.text()).slice(0, 300)}`
            );
        }

        const payload = (await response.json()) as GetTestsResponse;
        if (payload.errors?.length) {
            throw new Error(
                `Xray devolvio errores para ${selector}: ${payload.errors.map((error) => error.message).join("; ")}`
            );
        }

        const results =
            payload.data?.getTests?.results ??
            payload.data?.getTestPlan?.tests?.results ??
            payload.data?.getTestPlans?.results?.flatMap((plan) => plan.tests?.results ?? []) ??
            [];
        if (results.length === 0) {
            throw new Error(`Xray no encontro ningun Test para "${selector}".`);
        }

        return results.map(toTestCase);
    }

    private async authenticate(): Promise<string> {
        if (this.token) return this.token;

        const response = await fetch(
            `${this.options.baseUrl.replace(/\/+$/, "")}/api/v2/authenticate`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    client_id: this.options.clientId,
                    client_secret: this.options.clientSecret,
                }),
                signal: AbortSignal.timeout(this.options.timeoutMs),
            }
        );

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

function queryFor(selector: string): string {
    const clean = selector.trim();
    const fields = `issueId testType { name } steps { action data result }
        jira(fields: ["key", "summary", "priority", "labels"])`;

    if (clean.startsWith("plan:")) {
        const planKey = clean.slice("plan:".length).trim();
        if (!planKey) throw new Error("El selector plan: requiere una clave de Test Plan.");
        // El CLI recibe la clave legible de Jira/Xray (p.ej. CINE-PLAN-7), no
        // el issueId interno. getTestPlans permite resolverla con JQL oficial.
        const jql = `key = "${escapeJql(planKey)}"`;
        return `query { getTestPlans(jql: "${escapeGraphql(jql)}", limit: 1) {
            results { tests(limit: 100) { results { ${fields} } } }
        } }`;
    }

    let jql: string;
    if (clean.startsWith("jql:")) {
        jql = clean.slice("jql:".length).trim();
    } else if (clean.startsWith("keys:")) {
        const keys = clean
            .slice("keys:".length)
            .split(",")
            .map((key) => key.trim())
            .filter(Boolean);
        if (keys.length === 0) throw new Error("El selector keys: requiere al menos una clave.");
        jql = `key in (${keys.map((key) => `"${escapeJql(key)}"`).join(", ")})`;
    } else {
        jql = `key = "${escapeJql(clean)}"`;
    }

    if (!jql) throw new Error("La consulta JQL no puede estar vacia.");
    return `query { getTests(jql: "${escapeGraphql(jql)}", limit: 100) {
        results { ${fields} }
    } }`;
}

function escapeGraphql(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
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
