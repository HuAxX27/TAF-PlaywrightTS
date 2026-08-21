import { agentConfig } from "../config";
import { FileStorySource } from "./fileSource";
import { FileTestCaseSource } from "./fileTestCaseSource";
import { JiraStorySource } from "./jiraSource";
import type { StorySource } from "./storySource";
import type { TestCaseSource } from "./testCaseSource";
import { XrayTestCaseSource } from "./xrayTestCaseSource";

export type { StorySource } from "./storySource";
export type { TestCaseSource } from "./testCaseSource";

export function createStorySource(kind = agentConfig.storySource): StorySource {
    switch (kind.trim().toLowerCase()) {
        case "jira":
            return JiraStorySource.fromEnv(agentConfig.timeoutMs);
        case "file":
            return new FileStorySource(agentConfig.storyDir);
        default:
            throw new Error(`Origen de historia desconocido "${kind}". Usa "jira" o "file".`);
    }
}

/** Origen para el flujo "TC ya definido -> spec": Xray, o un archivo local para demos. */
export function createTestCaseSource(kind = agentConfig.testCaseSource): TestCaseSource {
    switch (kind.trim().toLowerCase()) {
        case "xray":
            return XrayTestCaseSource.fromEnv(agentConfig.timeoutMs);
        case "file":
            return new FileTestCaseSource(agentConfig.testCaseDir);
        default:
            throw new Error(
                `Origen de test cases desconocido "${kind}". Usa "xray" o "file".`
            );
    }
}
