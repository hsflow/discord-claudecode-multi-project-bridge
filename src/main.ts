import 'dotenv/config';
import {
  Client,
  Events,
  GatewayIntentBits,
  ChannelType,
  type Message,
  type TextChannel,
  type ThreadChannel,
} from 'discord.js';
import path from 'node:path';
import { ConfigManager } from './config-manager.js';
import { setupChannelWatcher } from './channel-watcher.js';
import { runClaude, cleanupStaleSessions, type ProgressEvent } from './claude-runner.js';
import type { BridgeConfig } from './types.js';

// --- Environment validation ---
function loadConfig(): BridgeConfig {
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

// --- Discord message chunking (2000 char limit) ---
function chunkMessage(text: string, maxLength = 1900): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

// --- Concurrency control ---
let activeSessions = 0;

// --- Per-channel progress thread (reuse one thread per channel) ---
const progressThreads: Map<string, ThreadChannel> = new Map();

// --- Progress thread helper ---
async function postProgress(
  thread: ThreadChannel,
  event: ProgressEvent,
  lastPostTime: { value: number },
): Promise<void> {
  const now = Date.now();
  if (now - lastPostTime.value < 3000) return;
  lastPostTime.value = now;

  const text = String(event.summary || '').slice(0, 1900);
  if (!text) return;

  try {
    await thread.send(text);
  } catch {
    // Best-effort
  }
}

// --- Main ---
async function main() {
  const config = loadConfig();

  const configDir = process.env.BRIDGE_HOME || path.join(process.env.HOME || '/home/claude', '.bridge');
  const configPath = path.join(configDir, 'config.json');
  const configManager = new ConfigManager(configPath);

  // --- Single Discord client ---
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.ClientReady, (c) => {
    console.log(`[main] Bot logged in as ${c.user.tag}`);
    console.log(`[main] Watching category: ${config.watchCategoryId}`);
    console.log(`[main] Workspace: ${config.workspacePath}`);
    console.log(`[main] Projects loaded: ${configManager.getAllProjects().length}`);
  });

  // --- Channel watcher (shares the same client) ---
  setupChannelWatcher({
    client,
    watchCategoryId: config.watchCategoryId,
    workspacePath: config.workspacePath,
    configManager,
    onProjectCreated: (channelId, name, directory) => {
      console.log(`[main] New project registered: ${name} -> ${directory}`);
    },
  });

  // --- Session cleanup interval ---
  setInterval(() => {
    cleanupStaleSessions(config.sessionTimeoutMs);
  }, 60_000);

  // --- Message handler ---
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const channelId = message.channel.isThread()
      ? (message.channel.parentId || message.channelId)
      : message.channelId;

    const project = configManager.resolveProject(channelId);
    if (!project) return;

    if (activeSessions >= config.maxConcurrentSessions) {
      try { await message.reply('⏳ Maximum concurrent sessions reached. Please wait.'); } catch { /* */ }
      return;
    }

    // Get or create a single progress thread per channel
    let progressThread: ThreadChannel | null = null;
    const threadName = `⚙️ ${project.name} - 作業ログ`.slice(0, 100);

    if (!message.channel.isThread() && message.channel.type === ChannelType.GuildText) {
      // 1. Check in-memory cache
      const cached = progressThreads.get(channelId);
      if (cached) {
        try {
          if (cached.archived) await cached.setArchived(false);
          await cached.send(`---\n📨 **新しいリクエスト:** ${message.content.slice(0, 200)}`);
          progressThread = cached;
        } catch {
          progressThreads.delete(channelId);
        }
      }

      // 2. Search for existing thread in the channel (covers restarts)
      if (!progressThread) {
        try {
          const activeThreads = await (message.channel as TextChannel).threads.fetchActive();
          const found = activeThreads.threads.find(t => t.name === threadName);
          if (found) {
            progressThread = found as ThreadChannel;
            progressThreads.set(channelId, progressThread);
            await progressThread.send(`---\n📨 **新しいリクエスト:** ${message.content.slice(0, 200)}`);
          }
        } catch {
          // Failed to fetch threads
        }
      }

      // 3. Create new thread only if none found
      if (!progressThread) {
        try {
          progressThread = await (message.channel as TextChannel).threads.create({
            name: threadName,
            autoArchiveDuration: 1440,
          });
          progressThreads.set(channelId, progressThread);
          await progressThread.send(`📨 **リクエスト:** ${message.content.slice(0, 200)}`);
        } catch {
          // Thread creation failed
        }
      }
    }

    const sessionKey = channelId;
    const lastPostTime = { value: 0 };

    activeSessions++;
    try {
      console.log(`[main] Running Claude for #${project.name} (session: ${sessionKey})`);

      const result = await runClaude({
        prompt: message.content,
        projectDir: project.directory,
        sessionKey,
        permissionMode: config.claudePermissionMode,
        timeoutMs: config.sessionTimeoutMs,
        onProgress: progressThread
          ? (event: ProgressEvent) => { postProgress(progressThread!, event, lastPostTime); }
          : undefined,
      });

      const chunks = chunkMessage(result.text);
      for (let i = 0; i < chunks.length; i++) {
        try {
          if (i === 0) {
            await message.reply(chunks[i]);
          } else {
            if ('send' in message.channel) await message.channel.send(chunks[i]);
          }
        } catch {
          // Channel may have been deleted
        }
      }

      if (progressThread) {
        try { await progressThread.send('✅ 完了しました'); } catch { /* */ }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[main] Error running Claude:`, errorMsg);

      try { await message.reply(`❌ Error: ${errorMsg.slice(0, 500)}`); } catch { /* */ }
      if (progressThread) {
        try { await progressThread.send(`❌ エラー: ${errorMsg.slice(0, 500)}`); } catch { /* */ }
      }
    } finally {
      activeSessions--;
    }
  });

  // --- Start ---
  console.log('[main] Starting Discord Claude Code Bridge...');
  await client.login(config.discordBotToken);
  console.log('[main] Bridge is running.');

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log('[main] Shutting down...');
    client.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[main] Fatal error:', err);
  process.exit(1);
});
