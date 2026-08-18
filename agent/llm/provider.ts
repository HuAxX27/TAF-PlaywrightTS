/**
 * Frontera con el proveedor de IA.
 *
 * Todo el pipeline habla SOLO con esta interfaz: cambiar de CodeMie a Gemini,
 * Groq, Ollama o cualquier otro no toca ni una linea de los pasos del agente.
 */

export interface CompletionRequest {
    system: string;
    prompt: string;
    temperature?: number;
}

export interface LlmProvider {
    /** Nombre legible del proveedor, para logs y reportes. */
    readonly name: string;
    /** Modelo concreto en uso. */
    readonly model: string;
    complete(request: CompletionRequest): Promise<string>;
}

/**
 * Los LLMs devuelven JSON envuelto en prosa o en bloques markdown con una
 * frecuencia incomoda. Esto extrae el primer objeto/array balanceado.
 */
export function extractJson<T>(raw: string): T {
    const trimmed = raw.trim();

    const candidates: string[] = [trimmed];

    const fenced = trimmed.match(/```(?:json|ts|typescript)?\s*([\s\S]*?)```/);
    if (fenced) {
        candidates.push(fenced[1].trim());
    }

    for (const open of ["[", "{"] as const) {
        const close = open === "[" ? "]" : "}";
        const start = trimmed.indexOf(open);
        const end = trimmed.lastIndexOf(close);
        if (start !== -1 && end > start) {
            candidates.push(trimmed.slice(start, end + 1));
        }
    }

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate) as T;
        } catch {
            continue;
        }
    }

    throw new Error(
        `La respuesta del modelo no contiene JSON parseable. Respuesta cruda:\n${trimmed.slice(0, 800)}`
    );
}

/** Quita los cercos markdown de una respuesta que deberia ser solo codigo. */
export function extractCode(raw: string): string {
    const fenced = raw.match(/```(?:ts|typescript|javascript)?\s*([\s\S]*?)```/);
    return (fenced ? fenced[1] : raw).trim();
}
