import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ProjectMapping } from './types.js';

interface ConfigData {
  projects: Record<string, { name: string; directory: string }>;
}

export class ConfigManager {
  private configPath: string;
  private projects: Map<string, ProjectMapping> = new Map();
  private writing = false;

  constructor(configPath: string) {
    this.configPath = configPath;
    this.ensureConfigExists();
    this.load();
  }

  private ensureConfigExists(): void {
    const dir = path.dirname(this.configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    if (!existsSync(this.configPath)) {
      writeFileSync(this.configPath, JSON.stringify({ projects: {} }, null, 2) + '\n');
    }
  }

  private load(): void {
    try {
      const raw: ConfigData = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      this.projects.clear();
      for (const [channelId, project] of Object.entries(raw.projects || {})) {
        this.projects.set(channelId, {
          channelId,
          name: project.name,
          directory: project.directory,
        });
      }
      console.log(`[config-manager] Loaded ${this.projects.size} project mappings`);
    } catch (err) {
      console.error(`[config-manager] Failed to load config, using empty:`, err);
      this.projects.clear();
    }
  }

  addProject(channelId: string, name: string, directory: string): void {
    // Serialize writes to prevent race conditions
    if (this.writing) {
      // Queue via in-memory update only; disk write on next call
      this.projects.set(channelId, { channelId, name, directory });
      console.log(`[config-manager] Queued project (write in progress): ${name}`);
      return;
    }

    this.writing = true;
    try {
      let raw: ConfigData;
      try {
        raw = JSON.parse(readFileSync(this.configPath, 'utf-8'));
      } catch {
        raw = { projects: {} };
      }

      raw.projects[channelId] = { name, directory };

      // Atomic write
      const tmpPath = this.configPath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(raw, null, 2) + '\n');
      renameSync(tmpPath, this.configPath);

      this.projects.set(channelId, { channelId, name, directory });
      console.log(`[config-manager] Added project: ${name} (${channelId}) -> ${directory}`);
    } finally {
      this.writing = false;
    }
  }

  resolveProject(channelId: string): ProjectMapping | undefined {
    return this.projects.get(channelId);
  }

  getAllProjects(): ProjectMapping[] {
    return Array.from(this.projects.values());
  }
}
