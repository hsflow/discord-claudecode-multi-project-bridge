import type { Message } from 'discord.js';
import type { ConfigManager } from './config-manager.js';
import type { BridgeConfig } from './types.js';
import type { ProgressEvent } from './claude-runner.js';
import { runClaude } from './claude-runner.js';
import { chunkMessage } from './discord-utils.js';
import { getOrCreateProgressThread, postProgress } from './progress-thread.js';

let activeSessions = 0;

export async function handleMessage(
  message: Message,
  config: BridgeConfig,
  configManager: ConfigManager,
): Promise<void> {
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

  const progressThread = await getOrCreateProgressThread(message, channelId, project);

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
        ? (event: ProgressEvent) => { postProgress(progressThread, event, lastPostTime); }
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
}
