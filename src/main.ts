import 'dotenv/config';
import { Client, Events, GatewayIntentBits, type Message } from 'discord.js';
import path from 'node:path';
import { loadConfig } from './env.js';
import { ConfigManager } from './config-manager.js';
import { setupChannelWatcher } from './channel-watcher.js';
import { cleanupStaleSessions } from './claude-runner.js';
import { handleMessage } from './message-handler.js';

async function main() {
  const config = loadConfig();

  const configDir = process.env.BRIDGE_HOME || path.join(process.env.HOME || '/home/claude', '.bridge');
  const configPath = path.join(configDir, 'config.json');
  const configManager = new ConfigManager(configPath);

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

  setupChannelWatcher({
    client,
    watchCategoryId: config.watchCategoryId,
    workspacePath: config.workspacePath,
    configManager,
    onProjectCreated: (channelId, name, directory) => {
      console.log(`[main] New project registered: ${name} -> ${directory}`);
    },
  });

  setInterval(() => {
    cleanupStaleSessions(config.sessionTimeoutMs);
  }, 60_000);

  client.on(Events.MessageCreate, (message: Message) => {
    handleMessage(message, config, configManager);
  });

  console.log('[main] Starting Discord Claude Code Bridge...');
  await client.login(config.discordBotToken);
  console.log('[main] Bridge is running.');

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
