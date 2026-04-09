import type { BridgeConfig } from './types.js';

export function loadConfig(): BridgeConfig {
  const required = ['DISCORD_BOT_TOKEN', 'WATCH_CATEGORY_ID'] as const;
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`);
      process.exit(1);
    }
  }

  return {
    discordBotToken: process.env.DISCORD_BOT_TOKEN!,
    watchCategoryId: process.env.WATCH_CATEGORY_ID!,
    workspacePath: process.env.WORKSPACE_PATH || '/workspace',
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '4', 10),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '1800000', 10),
    claudePermissionMode: process.env.CLAUDE_PERMISSION_MODE || 'acceptEdits',
  };
}
