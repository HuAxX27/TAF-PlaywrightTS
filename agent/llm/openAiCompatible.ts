import { CompletionRequest, LlmProvider } from "./provider";

export interface OpenAiCompatibleOptions {
    name: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    timeoutMs: number;
    defaultTemperature: number;
    extraHeaders?: Record<string, string>;
}

interface ChatCompletionResponse {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
}

const MAX_ATTEMPTS = 3;
const RETRIABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Un solo cliente cubre CodeMie, Gemini, Groq, OpenRouter, Ollama, LM Studio,
 * Azure OpenAI y cualquier gateway corporativo: todos exponen el mismo
 * contrato `POST /chat/completions` de OpenAI.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
    constructor(private readonly options: OpenAiCompatibleOptions) {}

    get name(): string {
        return this.options.name;
    }

    get model(): string {
        return this.options.model;
    }

    async complete(request: CompletionRequest): Promise<string> {
        const url = `${this.options.baseUrl.replace(/\/+$/, "")}/chat/completions`;
        const body = JSON.stringify({
            model: this.options.model,
            temperature: request.temperature ?? this.options.defaultTemperature,
            messages: [
                { role: "system", content: request.system },
                { role: "user", content: request.prompt },
            ],
        });

        let lastError: Error | undefined;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        ...(this.options.apiKey
                            ? { Authorization: `Bearer ${this.options.apiKey}` }
                            : {}),
                        ...this.options.extraHeaders,
                    },
                    body,
                    // Sin timeout explicito una peticion colgada bloquea todo el pipeline.
                    signal: AbortSignal.timeout(this.options.timeoutMs),
                });

                if (!response.ok) {
                    const detail = await response.text();
                    const error = new Error(
                        `${this.name} respondio ${response.status}: ${detail.slice(0, 500)}`
                    );
                    if (RETRIABLE_STATUS.has(response.status) && attempt < MAX_ATTEMPTS) {
                        lastError = error;
                        await sleep(attempt * 2000);
                        continue;
                    }
                    throw error;
                }

                const payload = (await response.json()) as ChatCompletionResponse;
                const content = payload.choices?.[0]?.message?.content;

                if (typeof content !== "string" || content.trim() === "") {
                    throw new Error(
                        `${this.name} devolvio una respuesta vacia: ${JSON.stringify(payload).slice(0, 500)}`
                    );
                }

                return content;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const isNetworkIssue =
                    lastError.name === "TimeoutError" ||
                    lastError.name === "AbortError" ||
                    lastError.message.includes("fetch failed");

                if (isNetworkIssue && attempt < MAX_ATTEMPTS) {
                    await sleep(attempt * 2000);
                    continue;
                }
                break;
            }
        }

        throw lastError ?? new Error(`${this.name}: fallo desconocido`);
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
