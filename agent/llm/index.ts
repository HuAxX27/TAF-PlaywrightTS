import { agentConfig } from "../config";
import { MockProvider } from "./mock";
import { OpenAiCompatibleProvider } from "./openAiCompatible";
import type { LlmProvider } from "./provider";

export type { LlmProvider, CompletionRequest } from "./provider";
export { extractJson, extractCode } from "./provider";

interface Preset {
    baseUrl: string;
    model: string;
    /** Variable de entorno donde vive la API key de ese proveedor. */
    keyEnv?: string;
    /** El proveedor funciona sin key (p.ej. un modelo local). */
    keyOptional?: boolean;
    extraHeaders?: Record<string, string>;
}

/**
 * Cambiar de proveedor = cambiar LLM_PROVIDER en el .env. Nada mas.
 * Cualquier endpoint compatible con OpenAI entra aqui sin escribir codigo.
 */
export const PRESETS: Record<string, Preset> = {
    gemini: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.6-flash",
        keyEnv: "GEMINI_API_KEY",
    },
    groq: {
        baseUrl: "https://api.groq.com/openai/v1",
        model: "llama-3.3-70b-versatile",
        keyEnv: "GROQ_API_KEY",
    },
    openrouter: {
        baseUrl: "https://openrouter.ai/api/v1",
        model: "deepseek/deepseek-chat-v3-0324:free",
        keyEnv: "OPENROUTER_API_KEY",
    },
    ollama: {
        baseUrl: "http://localhost:11434/v1",
        model: "qwen2.5-coder:7b",
        keyOptional: true,
    },
    codemie: {
        baseUrl: "https://codemie.lab.epam.com/code-assistant-api/v1",
        model: "gpt-4o",
        keyEnv: "CODEMIE_API_KEY",
    },
    custom: {
        baseUrl: "",
        model: "",
        keyEnv: "CUSTOM_API_KEY",
        keyOptional: true,
    },
};

export function availableProviders(): string[] {
    return ["mock", ...Object.keys(PRESETS)];
}

export function createProvider(name = agentConfig.provider): LlmProvider {
    const key = name.trim().toLowerCase();

    if (key === "mock") {
        return new MockProvider();
    }

    const preset = PRESETS[key];
    if (!preset) {
        throw new Error(
            `Proveedor desconocido "${name}". Disponibles: ${availableProviders().join(", ")}.`
        );
    }

    // Los overrides genericos ganan sobre el preset: sirven para apuntar a un
    // gateway interno o probar otro modelo sin tocar codigo.
    const baseUrl = process.env.LLM_BASE_URL?.trim() || preset.baseUrl;
    const model = process.env.LLM_MODEL?.trim() || preset.model;
    const apiKey =
        process.env.LLM_API_KEY?.trim() ||
        (preset.keyEnv ? process.env[preset.keyEnv]?.trim() : undefined);

    if (!baseUrl) {
        throw new Error(`El proveedor "${key}" necesita LLM_BASE_URL definido en el .env.`);
    }
    if (!model) {
        throw new Error(`El proveedor "${key}" necesita LLM_MODEL definido en el .env.`);
    }
    if (!apiKey && !preset.keyOptional) {
        throw new Error(
            `Falta la API key del proveedor "${key}". Define ${preset.keyEnv} (o LLM_API_KEY) en el .env.`
        );
    }

    return new OpenAiCompatibleProvider({
        name: key,
        baseUrl,
        model,
        apiKey,
        timeoutMs: agentConfig.timeoutMs,
        defaultTemperature: agentConfig.temperature,
        extraHeaders: preset.extraHeaders,
    });
}
