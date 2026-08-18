import type { UserStory } from "../types";
import { parseAcceptanceCriteria, type StorySource } from "./storySource";

interface JiraIssue {
    key: string;
    fields: Record<string, unknown> & {
        summary?: string;
        description?: unknown;
        labels?: string[];
    };
}

export interface JiraOptions {
    baseUrl: string;
    email: string;
    apiToken: string;
    /** Campo custom donde el proyecto guarda los criterios de aceptacion. */
    acField?: string;
    timeoutMs: number;
}

export class JiraStorySource implements StorySource {
    readonly name = "jira";

    constructor(private readonly options: JiraOptions) {}

    static fromEnv(timeoutMs: number): JiraStorySource {
        const baseUrl = process.env.JIRA_BASE_URL?.trim();
        const email = process.env.JIRA_EMAIL?.trim();
        const apiToken = process.env.JIRA_API_TOKEN?.trim();

        if (!baseUrl || !email || !apiToken) {
            throw new Error(
                "Faltan JIRA_BASE_URL, JIRA_EMAIL o JIRA_API_TOKEN en el .env. " +
                    "Para probar sin Jira usa --source=file."
            );
        }

        return new JiraStorySource({
            baseUrl,
            email,
            apiToken,
            acField: process.env.JIRA_AC_FIELD?.trim(),
            timeoutMs,
        });
    }

    async fetch(key: string): Promise<UserStory> {
        const auth = Buffer.from(`${this.options.email}:${this.options.apiToken}`).toString(
            "base64"
        );
        const url = `${this.options.baseUrl.replace(/\/+$/, "")}/rest/api/3/issue/${encodeURIComponent(key)}`;

        const response = await fetch(url, {
            headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
            signal: AbortSignal.timeout(this.options.timeoutMs),
        });

        if (!response.ok) {
            throw new Error(
                `Jira respondio ${response.status} al pedir ${key}: ${(await response.text()).slice(0, 300)}`
            );
        }

        const issue = (await response.json()) as JiraIssue;
        const description = flattenAdf(issue.fields.description);
        const acField = this.options.acField ? flattenAdf(issue.fields[this.options.acField]) : "";

        return {
            key: issue.key,
            title: issue.fields.summary ?? key,
            description,
            acceptanceCriteria: parseAcceptanceCriteria(acField || description),
            labels: issue.fields.labels ?? [],
            url: `${this.options.baseUrl.replace(/\/+$/, "")}/browse/${issue.key}`,
        };
    }
}

interface AdfNode {
    type?: string;
    text?: string;
    content?: AdfNode[];
}

/**
 * Jira Cloud devuelve la descripcion en Atlassian Document Format (un arbol),
 * no como texto. Esto lo aplana conservando vinetas y saltos de parrafo, que es
 * de donde salen los criterios de aceptacion.
 */
export function flattenAdf(value: unknown): string {
    if (typeof value === "string") return value;
    if (!value || typeof value !== "object") return "";

    const render = (node: AdfNode, listPrefix = ""): string => {
        if (node.type === "text") return node.text ?? "";
        if (node.type === "hardBreak") return "\n";

        const children = node.content ?? [];

        switch (node.type) {
            case "paragraph":
                return listPrefix + children.map((child) => render(child)).join("") + "\n";
            case "heading":
                return "\n## " + children.map((child) => render(child)).join("") + "\n";
            case "bulletList":
            case "orderedList":
                return children.map((child) => render(child, "- ")).join("");
            case "listItem":
                return children.map((child) => render(child, listPrefix)).join("");
            case "codeBlock":
                return "\n```\n" + children.map((child) => render(child)).join("") + "\n```\n";
            default:
                return children.map((child) => render(child, listPrefix)).join("");
        }
    };

    return render(value as AdfNode)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}
