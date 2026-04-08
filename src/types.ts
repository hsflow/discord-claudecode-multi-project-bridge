export interface ProjectMapping {
  channelId: string;
  name: string;
  directory: string;
}

export interface BridgeConfig {
  discordBotToken: string;
  watchCategoryId: string;
  workspacePath: string;
  maxConcurrentSessions: number;
  sessionTimeoutMs: number;
  claudePermissionMode: string;
}

export interface SessionInfo {
  sessionId: string | null;
  threadId: string;
  projectDir: string;
  lastActivity: number;
}
