import { Events, ChannelType, type Client } from 'discord.js';
import { createProjectDirectory } from './directory-manager.js';
import type { ConfigManager } from './config-manager.js';

// Reserved channel names that map to special directories instead of creating new ones
const RESERVED_CHANNELS: Record<string, string> = {
  'claude-root': '/claude-home',
};

interface ChannelWatcherOptions {
  client: Client;
  watchCategoryId: string;
  workspacePath: string;
  configManager: ConfigManager;
  onProjectCreated?: (channelId: string, name: string, directory: string) => void;
}

function registerChannel(
  channelId: string,
  channelName: string,
  workspacePath: string,
  configManager: ConfigManager,
  onProjectCreated?: (channelId: string, name: string, directory: string) => void,
): void {
  if (configManager.resolveProject(channelId)) return;

  const reservedPath = RESERVED_CHANNELS[channelName];
  const dirPath = reservedPath || createProjectDirectory(workspacePath, channelName);

  configManager.addProject(channelId, channelName, dirPath);
  console.log(`[channel-watcher] Mapped #${channelName} -> ${dirPath}`);

  onProjectCreated?.(channelId, channelName, dirPath);
}

export function setupChannelWatcher(options: ChannelWatcherOptions): void {
  const { client, watchCategoryId, workspacePath, configManager, onProjectCreated } = options;

  // Scan existing channels on startup
  client.on(Events.ClientReady, (c) => {
    let registered = 0;
    for (const channel of c.channels.cache.values()) {
      if (channel.type !== ChannelType.GuildText) continue;
      if (!('parentId' in channel) || channel.parentId !== watchCategoryId) continue;
      registerChannel(channel.id, channel.name, workspacePath, configManager, onProjectCreated);
      registered++;
    }
    console.log(`[channel-watcher] Startup scan complete: ${registered} channels processed`);
  });

  client.on(Events.ChannelCreate, async (channel) => {
    try {
      if (channel.type !== ChannelType.GuildText) return;
      if (channel.parentId !== watchCategoryId) return;

      console.log(`[channel-watcher] New channel detected: #${channel.name} (${channel.id})`);
      registerChannel(channel.id, channel.name, workspacePath, configManager, onProjectCreated);
    } catch (err) {
      console.error(`[channel-watcher] Error handling channel create:`, err);
    }
  });
}
