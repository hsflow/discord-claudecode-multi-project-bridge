#!/bin/bash
set -e

# Match the claude user's UID/GID to the workspace volume owner
# so file operations work correctly on bind-mounted directories
if [ -d /workspace ] && [ "$(id -u)" = "0" ]; then
  WORKSPACE_UID=$(stat -c '%u' /workspace 2>/dev/null || stat -f '%u' /workspace)
  WORKSPACE_GID=$(stat -c '%g' /workspace 2>/dev/null || stat -f '%g' /workspace)

  if [ "$WORKSPACE_UID" != "0" ]; then
    usermod -u "$WORKSPACE_UID" claude 2>/dev/null || true
    groupmod -g "$WORKSPACE_GID" claude 2>/dev/null || true
    chown -R claude:claude /home/claude /app 2>/dev/null || true
  fi

  # Link /claude-home to /home/claude/.claude so Claude CLI picks up
  # global settings, skills, and CLAUDE.md from the mounted volume
  if [ -d /claude-home ]; then
    ln -sfn /claude-home /home/claude/.claude
    chown -h claude:claude /home/claude/.claude
  fi

  exec gosu claude node dist/main.js
else
  exec node dist/main.js
fi
