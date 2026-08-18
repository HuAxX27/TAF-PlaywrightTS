import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env variable: ${name}`);
    }
    return value;
}

export const env = {
    baseURL: required("BASE_URL"),
    testEnv: process.env.TEST_ENV ?? "dev",
    /**
     * Lazy: solo se exige USER_EMAIL/USER_PASSWORD cuando una prueba realmente
     * los usa. Asi el resto de la suite (y el agente, que invoca `playwright
     * test --list`) corre sin credenciales configuradas.
     */
    get credentials(): { email: string; password: string } {
        return {
            email: required("USER_EMAIL"),
            password: required("USER_PASSWORD"),
        };
    },
} as const;
