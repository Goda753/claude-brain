#!/bin/bash
# Claude Code + Claude Central full setup for Mac
# Run: bash ~/.claude/setup-mac.sh
# Or download and run: curl -sL https://command.digitalmaster.no/setup-mac.sh | bash

set -e
CLAUDE_DIR="$HOME/.claude"
mkdir -p "$CLAUDE_DIR"

echo "=== Claude Central Mac Setup ==="

# 1. Create/overwrite settings.json
cat > "$CLAUDE_DIR/settings.json" << 'EOF'
{
  "permissions": {
    "defaultMode": "bypassPermissions"
  },
  "model": "claude-opus-4-8",
  "effortLevel": "xhigh",
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/session-start.js",
            "timeout": 15
          }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/session-update.js",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/log-prompt.js",
            "timeout": 8
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/log-response.js",
            "timeout": 10,
            "async": true
          }
        ]
      },
      {
        "hooks": [
          {
            "type": "command",
            "command": "node ~/.claude/session-end.js",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@modelcontextprotocol/server-memory/dist/index.js"]
    },
    "sequential-thinking": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@modelcontextprotocol/server-sequential-thinking/dist/index.js"]
    },
    "filesystem": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@modelcontextprotocol/server-filesystem/dist/index.js", "/Users/USERNAME_PLACEHOLDER"]
    },
    "fetch": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/mcp-server-fetch/index.js"]
    },
    "playwright": {
      "command": "node",
      "args": ["/usr/local/lib/node_modules/@playwright/mcp/cli.js"]
    }
  }
}
EOF

# Fix the filesystem MCP path with the actual username
sed -i '' "s|USERNAME_PLACEHOLDER|$(whoami)|g" "$CLAUDE_DIR/settings.json"

echo "  settings.json written"

# 2. Download hook scripts from Claude Central
API_BASE="https://command.digitalmaster.no"
API_KEY="cc_live_ac738c34d1470925ffbe15ddc7e854a7e9a0b6874099a805"

HOOK_SCRIPTS=(session-start.js session-update.js session-end.js log-prompt.js log-response.js sync-brain.js)
for script in "${HOOK_SCRIPTS[@]}"; do
  if [ -f "$CLAUDE_DIR/$script" ]; then
    echo "  $script already exists — re-downloading to ensure latest version..."
  fi
  echo "  Downloading $script..."
  if curl -sf -H "X-API-Key: $API_KEY" "$API_BASE/api.php?action=get_hook_file&name=$script" -o "$CLAUDE_DIR/$script" 2>/dev/null; then
    echo "  $script downloaded"
  else
    echo "  WARNING: Could not download $script — copy manually from Windows machine"
  fi
done

# Make scripts executable
chmod +x "$CLAUDE_DIR"/*.js 2>/dev/null || true

# 3. Sync brain (pull latest global rules)
if [ -f "$CLAUDE_DIR/sync-brain.js" ]; then
  echo "Syncing global rules from Claude Central brain..."
  node "$CLAUDE_DIR/sync-brain.js" 2>/dev/null && echo "  Brain synced" || echo "  (sync failed — rules will load on next session start)"
fi

# 4. Install MCP servers if not present
echo ""
echo "Checking MCP servers..."
npm list -g @modelcontextprotocol/server-memory 2>/dev/null | grep -q server-memory \
  && echo "  server-memory already installed" \
  || npm install -g @modelcontextprotocol/server-memory

npm list -g @modelcontextprotocol/server-sequential-thinking 2>/dev/null | grep -q sequential-thinking \
  && echo "  server-sequential-thinking already installed" \
  || npm install -g @modelcontextprotocol/server-sequential-thinking

npm list -g @modelcontextprotocol/server-filesystem 2>/dev/null | grep -q server-filesystem \
  && echo "  server-filesystem already installed" \
  || npm install -g @modelcontextprotocol/server-filesystem

npm list -g mcp-server-fetch 2>/dev/null | grep -q mcp-server-fetch \
  && echo "  mcp-server-fetch already installed" \
  || npm install -g mcp-server-fetch

npm list -g @playwright/mcp 2>/dev/null | grep -q playwright \
  && echo "  @playwright/mcp already installed" \
  || npm install -g @playwright/mcp

echo ""
echo "=== Setup Complete ==="
echo "Claude Central connected. Brain rules injected on every session start."
echo "Dashboard: https://command.digitalmaster.no (pass: ClaudeCommand2026)"
echo ""
echo "To start Claude Code: claude"

echo ""
echo "Running integration check..."
node "$CLAUDE_DIR/auto-check.js"
