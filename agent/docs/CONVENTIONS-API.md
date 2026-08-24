# Convenciones para Tests de API

Aplican a todo spec que valide un servicio sin abrir navegador. Viven en `tests/api/<recurso>/`.

## Estructura de archivos

```
tests/api/<recurso>/<tc-id>-<slug>.spec.ts   Spec
src/api/apiClient.ts                         Cliente HTTP base
src/api/services/<recurso>Service.ts         Un service por recurso
src/data/<recurso>Factory.ts                 Payloads con faker
src/fixtures/test.ts                         Registro de fixtures
```

## Anatomía del spec

```typescript
import { test, expect } from "../../../src/fixtures/test";
import { createUser } from "../../../src/data/userFactory";

test.describe("TC-05 - Usuarios: creación", () => {
    test("POST /api/users crea el usuario y responde 201", { tag: ["@api", "@smoke"] }, async ({ userService }) => {
        const payload = createUser();

        await test.step("1. Enviar la solicitud de creación", async () => {
            const response = await userService.createUserRaw(payload);
            expect(response.status()).toBe(201);

            const body = await response.json();
            expect(body).toMatchObject({ email: payload.email });
            expect(body.id).toBeTruthy();
        });
    });
});
```

## Reglas

1. **Prohibido el fixture `page`**, Page Objects, locators y `getByRole`. Un test de API que abre
   navegador está mal escrito.
2. Las llamadas HTTP van en un **Service**, nunca en el spec. El spec prepara datos, invoca el
   service y hace assertions.
3. Tags inline: `{ tag: ["@api", ...] }`. Todo test de API lleva `@api`.
4. **Afirmar siempre el status code explícitamente**: `expect(response.status()).toBe(201)`.
   No basta con que la llamada no lance excepción.
5. Para casos negativos (400, 401, 404, 422) usar un método que devuelva la respuesta cruda, no uno
   que lance excepción al no recibir 2xx.
6. Interfaces TypeScript para request y response. Prohibido `any`.
7. Limpiar lo creado en `test.afterEach` o al final del test.
8. Payloads desde factories de `src/data/` con faker; nunca credenciales hardcodeadas.
9. Sin sleeps ni timeouts arbitrarios.

## Service

```typescript
import { APIResponse } from "@playwright/test";
import { ApiClient } from "../apiClient";

export interface User {
    id: string;
    email: string;
    name: string;
}

export class UserService {
    constructor(private readonly api: ApiClient) {}

    /** Camino feliz: lanza si el status no es 2xx. */
    async createUser(data: Partial<User>): Promise<User> {
        return this.api.post<User>("/api/users", data);
    }

    /** Respuesta cruda: necesaria para afirmar status codes y casos negativos. */
    async createUserRaw(data: Partial<User>): Promise<APIResponse> {
        return this.api.postRaw("/api/users", data);
    }

    async deleteUser(id: string): Promise<void> {
        await this.api.delete(`/api/users/${id}`);
    }
}
```

## Verificación de contrato

```typescript
// Campos y tipos, no solo presencia
expect(body).toMatchObject({
    id: expect.any(String),
    email: payload.email,
});

// Headers cuando el test case lo pide
expect(response.headers()["content-type"]).toContain("application/json");
```

## Casos negativos

```typescript
test("POST /api/users con email inválido responde 422", { tag: ["@api", "@negative"] }, async ({ userService }) => {
    const response = await userService.createUserRaw({ email: "no-es-un-email" });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.message).toMatch(/email/i);
});
```

## Limpieza

```typescript
test.afterEach(async ({ userService }) => {
    for (const id of createdUserIds) {
        await userService.deleteUser(id).catch(() => undefined);
    }
    createdUserIds.length = 0;
});
```
