import {
  ChannelType,
  type TextChannel,
  type ThreadChannel,
  type Message,
} from 'discord.js';
import type { ProgressEvent } from './claude-runner.js';
import type { ProjectMapping } from './types.js';

const progressThreads: Map<string, ThreadChannel> = new Map();

function buildThreadName(projectName: string): string {
  return `⚙️ ${projectName} - 作業ログ`.slice(0, 100);
}

/**
 * Get or create a single progress thread per channel.
 * Falls back through: in-memory cache → active thread search → create new.
 */
export async function getOrCreateProgressThread(
  message: Message,
  channelId: string,
  project: ProjectMapping,
): Promise<ThreadChannel | null> {
  if (message.channel.isThread() || message.channel.type !== ChannelType.GuildText) {
    return null;
  }

  const threadName = buildThreadName(project.name);
  const requestPreview = message.content.slice(0, 200);

  // 1. Check in-memory cache
  const cached = progressThreads.get(channelId);
  if (cached) {
    try {
      if (cached.archived) await cached.setArchived(false);
      await cached.send(`---\n📨 **新しいリクエスト:** ${requestPreview}`);
      return cached;
    } catch {
      progressThreads.delete(channelId);
    }
  }

  // 2. Search for existing thread in the channel (covers restarts)
  try {
    const activeThreads = await (message.channel as TextChannel).threads.fetchActive();
    const found = activeThreads.threads.find(t => t.name === threadName);
    if (found) {
      const thread = found as ThreadChannel;
      progressThreads.set(channelId, thread);
      await thread.send(`---\n📨 **新しいリクエスト:** ${requestPreview}`);
      return thread;
    }
  } catch {
    // Failed to fetch threads
  }

  // 3. Create new thread
  try {
    const thread = await (message.channel as TextChannel).threads.create({
      name: threadName,
      autoArchiveDuration: 1440,
    });
    progressThreads.set(channelId, thread);
    await thread.send(`📨 **リクエスト:** ${requestPreview}`);
    return thread;
  } catch {
    // Thread creation failed
  }

  return null;
}

/**
 * Post a progress event to the thread, throttled to once per 3 seconds.
 */
export async function postProgress(
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
