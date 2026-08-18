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
    credentials: {
        email: required("USER_EMAIL"),
        password: required("USER_PASSWORD"),
    },
} as const;
