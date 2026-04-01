#!/bin/bash
set -e

SETTINGS_DIR="$HOME/.claude"
SETTINGS_FILE="$SETTINGS_DIR/settings.json"
mkdir -p "$SETTINGS_DIR"

if [ -f /workspace/input/.credentials.json ]; then
  cp /workspace/input/.credentials.json "$SETTINGS_DIR/.credentials.json"
fi

SETTINGS='{"permissions":{"defaultMode":"bypassPermissions"}}'

if [ -f /workspace/input/mcp_config.json ]; then
  MCP_CONTENT=$(cat /workspace/input/mcp_config.json)
  SETTINGS=$(echo "$SETTINGS" | python3 -c "
import sys, json
settings = json.load(sys.stdin)
with open('/workspace/input/mcp_config.json') as f:
    mcp = json.load(f)
settings.update(mcp)
json.dump(settings, sys.stdout)
")
fi

echo "$SETTINGS" > "$SETTINGS_FILE"

if [ -d /workspace/input/skills ]; then
  cp -r /workspace/input/skills /workspace/skills
fi

if [ -f /workspace/input/CLAUDE.md ]; then
  cp /workspace/input/CLAUDE.md /workspace/CLAUDE.md
fi

ATTACHED_FILES=""
if [ -d /workspace/input/files ]; then
  cp -r /workspace/input/files/* /workspace/ 2>/dev/null || true
  FILE_LIST=$(ls /workspace/input/files/ 2>/dev/null)
  if [ -n "$FILE_LIST" ]; then
    ATTACHED_FILES="

The following files have been attached to this task and are available in /workspace/:
$FILE_LIST
Use the Read tool to view these files (including images)."
  fi
fi

CMD="claude -p --dangerously-skip-permissions --output-format stream-json --verbose"

if [ -n "$CLAUDE_MODEL" ]; then
  CMD="$CMD --model $CLAUDE_MODEL"
fi

if [ -n "$CLAUDE_THINKING_EFFORT" ]; then
  CMD="$CMD --effort $CLAUDE_THINKING_EFFORT"
fi

if [ -n "$MAX_TURNS" ]; then
  CMD="$CMD --max-turns $MAX_TURNS"
fi

cd /workspace

# Run initial prompt. Redirect stdin from /dev/null so claude
# doesn't consume the container's stdin (needed for follow-ups).
$CMD "${INITIAL_PROMPT}${ATTACHED_FILES}" </dev/null

# Auto-continue loop: send follow-up prompt N times automatically.
if [ "${AUTO_CONTINUE_COUNT:-0}" -gt 0 ]; then
  for i in $(seq 1 "$AUTO_CONTINUE_COUNT"); do
    $CMD --continue "${AUTO_CONTINUE_PROMPT:-continue}" </dev/null
  done
fi

# Wait for follow-up prompts via container stdin.
# Each line is run as a continuation of the same conversation.
# read blocks until data arrives, keeping the container alive.
while IFS= read -r line; do
  if [ -n "$line" ]; then
    $CMD --continue "$line" </dev/null
  fi
done
