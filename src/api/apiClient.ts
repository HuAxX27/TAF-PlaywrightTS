import { APIRequestContext, request } from "@playwright/test";
import { env } from "../config/env";

export class ApiClient {
    private constructor(private readonly context: APIRequestContext) {}

    static async create(token?: string): Promise<ApiClient> {
        const context = await request.newContext({
            baseURL: env.baseURL,
            extraHTTPHeaders: token
            ? { Authorization: `Bearer ${token}`}
            : {},
        });
        return new ApiClient(context);
    }

    async get<T>(url: string): Promise<T> {
        const res = await this.context.get(url);
        this.assertOk(res.status(), url, "GET");
        return res.json() as Promise<T>;
    }

    async post<T>(url: string, data:  unknown): Promise<T> {
        const res = await this.context.post(url, { data });
        this.assertOk(res.status(), url, "POST");
        return res.json() as Promise<T>;
    }

    async delete(url: string): Promise<void> {
        const res = await this.context.delete(url);
        this.assertOk(res.status(), url, "DELETE");
    }

    async dispose(): Promise<void> {
        await this.context.dispose();
    }

    private assertOk(status: number, url: string, method: string): void {
        if (status < 200 || status > 300) {
            throw new Error(`${method} ${url} failed with status ${status}`);
        }
    }
}