import { agentConfig } from "../config";
import { FileStorySource } from "./fileSource";
import { JiraStorySource } from "./jiraSource";
import type { StorySource } from "./storySource";

export type { StorySource } from "./storySource";

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
