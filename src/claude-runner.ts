import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionInfo } from './types.js';

const SESSIONS_PATH = join(process.env.BRIDGE_HOME ?? '/tmp', 'sessions.json');

function loadSessions(): Map<string, SessionInfo> {
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_PATH, 'utf-8')) as Record<string, SessionInfo>;
    const now = Date.now();
    return new Map(
      Object.entries(raw).map(([k, v]) => [k, { ...v, lastActivity: now }]),
    );
  } catch {
    return new Map();
  }
}

function persistSessions(): void {
  try {
    const obj = Object.fromEntries(sessions);
    writeFileSync(SESSIONS_PATH, JSON.stringify(obj, null, 2) + '\n');
  } catch (err) {
    console.error('[claude-runner] Failed to persist sessions:', err);
  }
}

const sessions: Map<string, SessionInfo> = loadSessions();

const activeRuns: Set<Promise<unknown>> = new Set();

export function waitForActiveRuns(timeoutMs = 30_000): Promise<void> {
  if (activeRuns.size === 0) return Promise.resolve();
  console.log(`[claude-runner] Waiting for ${activeRuns.size} active run(s) to complete...`);
  return Promise.race([
    Promise.allSettled([...activeRuns]),
    new Promise<void>((resolve) => setTimeout(() => {
      console.log('[claude-runner] Graceful shutdown timeout reached, forcing exit');
      resolve();
    }, timeoutMs)),
  ]).then(() => undefined);
}

// Allowlisted env vars passed to Claude CLI (prevent leaking DISCORD_BOT_TOKEN etc.)
const ALLOWED_ENV_KEYS = [
  'PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TERM',
  'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN', 'NODE_ENV',
];

function buildChildEnv(): Record<string, string> {
  const env: Record<string, string> = { CI: 'true' };
  for (const key of ALLOWED_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return env;
}

export function cleanupStaleSessions(maxAgeMs: number): void {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, session] of sessions) {
    if (now - session.lastActivity > maxAgeMs) {
      sessions.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[claude-runner] Cleaned up ${cleaned} stale sessions`);
    persistSessions();
  }
}

export interface ProgressEvent {
  type: 'tool_use' | 'thinking' | 'text' | 'tool_result' | 'error';
  summary: string;
}

export interface RunClaudeOptions {
  prompt: string;
  projectDir: string;
  sessionKey: string;
  permissionMode: string;
  timeoutMs?: number;
  onProgress?: (event: ProgressEvent) => void;
}

function parseStreamEvent(line: string, onProgress?: (event: ProgressEvent) => void): void {
  if (!onProgress) return;

  try {
    const event = JSON.parse(line);

    if (event.type === 'assistant' && event.message?.content) {
      for (const block of event.message.content) {
        if (block.type === 'tool_use') {
          const toolName = block.name || 'unknown';
          const input = block.input || {};
          let detail = '';
          if (input.command) detail = `\`${String(input.command).slice(0, 100)}\``;
          else if (input.file_path) detail = `\`${String(input.file_path)}\``;
          else if (input.pattern) detail = `\`${String(input.pattern)}\``;
          else if (input.description) detail = String(input.description).slice(0, 100);

          onProgress({
            type: 'tool_use',
            summary: `🔧 **${toolName}** ${detail}`,
          });
        } else if (block.type === 'thinking' && block.thinking) {
          const preview = String(block.thinking).slice(0, 200);
          onProgress({
            type: 'thinking',
            summary: `💭 ${preview}${block.thinking.length > 200 ? '...' : ''}`,
          });
        }
      }
    }

    if (event.type === 'user' && event.tool_use_result) {
      const stdout = String(event.tool_use_result.stdout || '');
      const stderr = String(event.tool_use_result.stderr || '');
      const output = (stdout || stderr).slice(0, 200);
      if (output) {
        onProgress({
          type: 'tool_result',
          summary: `📋 \`\`\`\n${output}${(stdout + stderr).length > 200 ? '\n...' : ''}\n\`\`\``,
        });
      }
    }
  } catch {
    // Non-JSON line
  }
}

export async function runClaude(
  options: RunClaudeOptions,
): Promise<{ text: string; sessionId: string | null }> {
  const {
    prompt,
    projectDir,
    sessionKey,
    permissionMode,
    timeoutMs = 1200000,
    onProgress,
  } = options;

  const session = sessions.get(sessionKey);

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--permission-mode', permissionMode,
  ];

  if (session?.sessionId) {
    args.push('--resume', session.sessionId);
    console.log(`[claude-runner] Resuming session ${session.sessionId} for ${sessionKey}`);
  } else {
    console.log(`[claude-runner] Starting new session for ${sessionKey}`);
  }

  // "--" prevents prompt from being interpreted as a CLI flag
  args.push('--', prompt);

  const run = new Promise<{ text: string; sessionId: string | null }>((resolve, reject) => {
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    const proc: ChildProcess = spawn('claude', args, {
      cwd: projectDir,
      env: buildChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buffer = '';
    let resultText = '';
    let resultSessionId: string | null = null;
    let isError = false;
    let stderr = '';

    proc.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString();

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        parseStreamEvent(line, onProgress);

        try {
          const event = JSON.parse(line);
          if (event.type === 'result') {
            resultText = event.result || '';
            resultSessionId = event.session_id || null;
            isError = event.is_error === true;
          }
        } catch {
          // Not JSON
        }
      }
    });

    proc.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      settle(() => reject(new Error(`Claude timed out after ${timeoutMs / 1000}s`)));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);

      // Process remaining buffer
      if (buffer.trim()) {
        parseStreamEvent(buffer, onProgress);
        try {
          const event = JSON.parse(buffer);
          if (event.type === 'result') {
            resultText = event.result || '';
            resultSessionId = event.session_id || null;
            isError = event.is_error === true;
          }
        } catch {
          // Not JSON
        }
      }

      if (code !== 0 && !resultText) {
        if (session?.sessionId && !settled) {
          console.log(`[claude-runner] Session ${session.sessionId} failed, retrying fresh`);
          sessions.delete(sessionKey);
          persistSessions();
          runClaude({ ...options }).then(
            (r) => settle(() => resolve(r)),
            (e) => settle(() => reject(e)),
          );
          return;
        }
        settle(() => reject(new Error(`Claude exited with code ${code}: ${stderr}`)));
        return;
      }

      if (resultSessionId) {
        if (session?.sessionId && resultSessionId !== session.sessionId) {
          console.log(`[claude-runner] Session ID changed: ${session.sessionId} -> ${resultSessionId} (resume may have failed silently)`);
        }
        sessions.set(sessionKey, {
          sessionId: resultSessionId,
          threadId: sessionKey,
          projectDir,
          lastActivity: Date.now(),
        });
        persistSessions();
      }

      settle(() => {
        if (isError) {
          resolve({ text: `⚠️ Error: ${resultText}`, sessionId: resultSessionId });
        } else {
          resolve({ text: resultText || 'No response', sessionId: resultSessionId });
        }
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`Failed to start Claude CLI: ${err.message}`)));
    });
  });

  activeRuns.add(run);
  run.finally(() => activeRuns.delete(run));
  return run;
}
