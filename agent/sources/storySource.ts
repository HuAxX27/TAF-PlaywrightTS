import type { UserStory } from "../types";

/**
 * De donde sale la User Story. Jira es el caso real; el archivo local permite
 * demostrar y testear el agente sin credenciales.
 */
export interface StorySource {
    readonly name: string;
    fetch(key: string): Promise<UserStory>;
}

const AC_HEADING = /criterios?\s+de\s+aceptaci[oó]n|acceptance\s+criteria|^\s*AC\s*:/i;
const BULLET = /^\s*(?:[-*+•]|\d+[.)])\s+(.*)$/;

/** Extrae la lista de criterios de aceptacion de un texto plano. */
export function parseAcceptanceCriteria(text: string): string[] {
    const lines = text.split(/\r?\n/);
    const headingIndex = lines.findIndex((line) => AC_HEADING.test(line));

    const scope = headingIndex === -1 ? lines : lines.slice(headingIndex + 1);
    const criteria: string[] = [];

    for (const line of scope) {
        // Al llegar a la siguiente seccion se corta la lista.
        if (criteria.length > 0 && /^#{1,6}\s/.test(line)) break;

        const bullet = line.match(BULLET);
        if (bullet && bullet[1].trim()) {
            criteria.push(bullet[1].trim());
        }
    }

    return criteria;
}
