import { APIResponse } from "@playwright/test";
import { ApiClient } from "../apiClient";

/**
 * Service para recursos CDN públicos (PDFs, imágenes, etc).
 * No requiere autenticación ni payloads.
 */
export class CdnService {
    constructor(private readonly api: ApiClient) {}

    /**
     * Obtiene la respuesta cruda de un recurso CDN (PDF).
     * @param url URL absoluta del recurso
     */
    async getPdfRaw(url: string): Promise<APIResponse> {
        // El contexto de ApiClient puede tener baseURL, pero para recursos externos usamos la URL absoluta.
        return this.api.getRaw(url);
    }
}
