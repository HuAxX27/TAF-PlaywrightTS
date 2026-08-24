import { agentConfig } from "../config";
import type { TestCaseSource } from "./testCaseSource";
import { XrayTestCaseSource } from "./xrayTestCaseSource";

export type { TestCaseSource } from "./testCaseSource";

/** Xray Cloud es la única entrada de negocio soportada por el agente. */
export function createTestCaseSource(): TestCaseSource {
    return XrayTestCaseSource.fromEnv(agentConfig.timeoutMs);
}
