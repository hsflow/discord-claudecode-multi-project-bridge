import { existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

export function sanitizeDirectoryName(channelName: string): string {
  const sanitized = channelName
    .replace(/[^\p{L}\p{N}\-_]/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Guard against empty result (e.g., channel named ".." or all special chars)
  return sanitized || `channel-${Date.now()}`;
}

export function createProjectDirectory(workspacePath: string, channelName: string): string {
  const dirName = sanitizeDirectoryName(channelName);
  const dirPath = path.join(workspacePath, dirName);

  if (existsSync(dirPath)) {
    console.log(`[directory-manager] Directory already exists: ${dirPath}`);
    return dirPath;
  }

  mkdirSync(dirPath, { recursive: true });
  console.log(`[directory-manager] Created directory: ${dirPath}`);

  try {
    execSync('git init', { cwd: dirPath, stdio: 'pipe' });
    execSync('git config user.email "bot@bridge.local"', { cwd: dirPath, stdio: 'pipe' });
    execSync('git config user.name "Bridge Bot"', { cwd: dirPath, stdio: 'pipe' });
    execSync('git commit --allow-empty -m "Initial commit"', { cwd: dirPath, stdio: 'pipe' });
    console.log(`[directory-manager] Initialized git repo: ${dirPath}`);
  } catch (err) {
    console.error(`[directory-manager] Failed to init git repo:`, err);
  }

  return dirPath;
}
