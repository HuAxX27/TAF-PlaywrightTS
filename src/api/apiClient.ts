import { APIRequestContext, APIResponse, request } from "@playwright/test";
import { env } from "../config/env";

export class ApiClient {
    private constructor(private readonly context: APIRequestContext) {}

    static async create(token?: string): Promise<ApiClient> {
        const context = await request.newContext({
            baseURL: env.baseURL,
            extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
        });
        return new ApiClient(context);
    }

    async get<T>(url: string): Promise<T> {
        const res = await this.context.get(url);
        this.assertOk(res.status(), url, "GET");
        return res.json() as Promise<T>;
    }

    async post<T>(url: string, data: unknown): Promise<T> {
        const res = await this.context.post(url, { data });
        this.assertOk(res.status(), url, "POST");
        return res.json() as Promise<T>;
    }

    async put<T>(url: string, data: unknown): Promise<T> {
        const res = await this.context.put(url, { data });
        this.assertOk(res.status(), url, "PUT");
        return res.json() as Promise<T>;
    }

    async patch<T>(url: string, data: unknown): Promise<T> {
        const res = await this.context.patch(url, { data });
        this.assertOk(res.status(), url, "PATCH");
        return res.json() as Promise<T>;
    }

    async delete(url: string): Promise<void> {
        const res = await this.context.delete(url);
        this.assertOk(res.status(), url, "DELETE");
    }

    /**
     * Respuesta cruda, sin validar el status.
     *
     * Los metodos tipados de arriba lanzan si el status no es 2xx, lo que hace
     * imposible probar un 400/401/404 esperado o afirmar el status code exacto:
     * para eso los tests de API usan estos.
     */
    async getRaw(url: string): Promise<APIResponse> {
        return this.context.get(url);
    }

    async postRaw(url: string, data: unknown): Promise<APIResponse> {
        return this.context.post(url, { data });
    }

    async putRaw(url: string, data: unknown): Promise<APIResponse> {
        return this.context.put(url, { data });
    }

    async patchRaw(url: string, data: unknown): Promise<APIResponse> {
        return this.context.patch(url, { data });
    }

    async deleteRaw(url: string): Promise<APIResponse> {
        return this.context.delete(url);
    }

    async dispose(): Promise<void> {
        await this.context.dispose();
    }

    private assertOk(status: number, url: string, method: string): void {
        if (status < 200 || status >= 300) {
            throw new Error(`${method} ${url} failed with status ${status}`);
        }
    }
}
