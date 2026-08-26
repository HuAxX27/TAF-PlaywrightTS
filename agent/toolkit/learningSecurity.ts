const SECRET_HINTS =
    /\b(password|passwd|contrase|secret|api[_-]?key|token|bearer|credential|client[_-]?secret|private[_-]?key)\b/i;
const SECRET_FIELD =
    /^(password|passwd|secret|apiKey|api_key|token|accessToken|refreshToken|credential|clientSecret|client_secret|privateKey|private_key)$/i;
const SECRET_ASSIGNMENT =
    /\b(password|passwd|secret|api[_-]?key|token|bearer|credential|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*\S+/i;
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function sanitizeForModel(value: unknown, state: { redactedValues: number }): unknown {
    if (typeof value === "string") {
        if (
            SECRET_HINTS.test(value) ||
            SECRET_ASSIGNMENT.test(value) ||
            EMAIL_ADDRESS.test(value)
        ) {
            state.redactedValues++;
            return "[REDACTED]";
        }
        return value;
    }
    if (Array.isArray(value)) return value.map((item) => sanitizeForModel(item, state));
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => {
                if (SECRET_FIELD.test(key)) {
                    state.redactedValues++;
                    return [key, "[REDACTED]"];
                }
                return [key, sanitizeForModel(item, state)];
            })
        );
    }
    return value;
}

export function findSecretLikeStrings(value: unknown, pathLabel = "root"): string[] {
    if (typeof value === "string") return SECRET_HINTS.test(value) ? [pathLabel] : [];
    if (Array.isArray(value)) {
        return value.flatMap((item, index) =>
            findSecretLikeStrings(item, `${pathLabel}[${index}]`)
        );
    }
    if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([key, item]) =>
            findSecretLikeStrings(item, `${pathLabel}.${key}`)
        );
    }
    return [];
}
