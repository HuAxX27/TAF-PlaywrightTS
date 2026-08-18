import * as fs from "fs";
import * as path from "path";
import type { UserStory } from "../types";
import { parseAcceptanceCriteria, type StorySource } from "./storySource";

/**
 * Lee la historia de `agent/stories/<KEY>.md` (o .json).
 *
 * Formato markdown esperado:
 *   # CIN-101 - Titulo de la historia
 *   ## Descripcion
 *   ...
 *   ## Criterios de aceptacion
 *   - criterio uno
 */
export class FileStorySource implements StorySource {
    readonly name = "file";

    constructor(private readonly storyDir: string) {}

    async fetch(key: string): Promise<UserStory> {
        const jsonPath = path.join(this.storyDir, `${key}.json`);
        if (fs.existsSync(jsonPath)) {
            const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Partial<UserStory>;
            return {
                key: parsed.key ?? key,
                title: parsed.title ?? key,
                description: parsed.description ?? "",
                acceptanceCriteria: parsed.acceptanceCriteria ?? [],
                labels: parsed.labels ?? [],
                url: parsed.url,
            };
        }

        const mdPath = path.join(this.storyDir, `${key}.md`);
        if (!fs.existsSync(mdPath)) {
            throw new Error(
                `No encontre la historia "${key}". Crea ${mdPath} (o ${jsonPath}), ` +
                    `o usa --source=jira si ya tienes credenciales configuradas.`
            );
        }

        const raw = fs.readFileSync(mdPath, "utf-8");
        return parseStoryMarkdown(key, raw);
    }
}

export function parseStoryMarkdown(key: string, raw: string): UserStory {
    const lines = raw.split(/\r?\n/);

    const titleLine = lines.find((line) => /^#\s+/.test(line)) ?? `# ${key}`;
    const headline = titleLine.replace(/^#\s+/, "").trim();
    // "# DEMO-1 - Titulo" -> "Titulo": la clave ya viaja aparte en el objeto.
    const title = headline.toLowerCase().startsWith(key.toLowerCase())
        ? headline
              .slice(key.length)
              .replace(/^\s*[-–—:]\s*/, "")
              .trim() || headline
        : headline;

    const sections = splitSections(raw);
    const description =
        sections.get("descripcion") ?? sections.get("description") ?? stripHeadings(raw);
    const acSection =
        sections.get("criterios de aceptacion") ?? sections.get("acceptance criteria");

    const labels = (sections.get("labels") ?? sections.get("etiquetas") ?? "")
        .split(/[,\n]/)
        .map((label) => label.replace(/^[-*+\s]+/, "").trim())
        .filter(Boolean);

    return {
        key,
        title,
        description: description.trim(),
        acceptanceCriteria: parseAcceptanceCriteria(acSection ?? raw),
        labels,
        url: raw.match(/^>\s*(https?:\/\/\S+)/m)?.[1],
    };
}

/** Devuelve un mapa "titulo de seccion normalizado" -> contenido. */
function splitSections(raw: string): Map<string, string> {
    const sections = new Map<string, string>();
    const lines = raw.split(/\r?\n/);

    let current: string | null = null;
    let buffer: string[] = [];

    const flush = () => {
        if (current) sections.set(current, buffer.join("\n").trim());
        buffer = [];
    };

    for (const line of lines) {
        const heading = line.match(/^#{2,6}\s+(.*)$/);
        if (heading) {
            flush();
            current = normalize(heading[1]);
        } else if (current) {
            buffer.push(line);
        }
    }
    flush();

    return sections;
}

function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z\s]/g, "")
        .trim();
}

function stripHeadings(raw: string): string {
    return raw
        .split(/\r?\n/)
        .filter((line) => !/^#{1,6}\s/.test(line))
        .join("\n");
}
