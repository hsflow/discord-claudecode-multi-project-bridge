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

export function setupChannelWatcher(options: ChannelWatcherOptions): void {
  const { client, watchCategoryId, workspacePath, configManager, onProjectCreated } = options;

  client.on(Events.ChannelCreate, async (channel) => {
    try {
      if (channel.type !== ChannelType.GuildText) return;
      if (channel.parentId !== watchCategoryId) return;

      const channelName = channel.name;
      const channelId = channel.id;

      console.log(`[channel-watcher] New channel detected: #${channelName} (${channelId})`);

      if (configManager.resolveProject(channelId)) {
        console.log(`[channel-watcher] Channel already mapped, skipping`);
        return;
      }

      const reservedPath = RESERVED_CHANNELS[channelName];
      const dirPath = reservedPath || createProjectDirectory(workspacePath, channelName);

      configManager.addProject(channelId, channelName, dirPath);
      console.log(`[channel-watcher] Mapped #${channelName} -> ${dirPath}`);

      onProjectCreated?.(channelId, channelName, dirPath);
    } catch (err) {
      console.error(`[channel-watcher] Error handling channel create:`, err);
    }
  });
}
