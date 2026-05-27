#!/bin/bash
# DeepSeek balance cache for cc-hud extra segment
# Query balance API → write "¥{total_balance}" to cache file
# Designed to run periodically (SessionStart hook / cron / manual)
#
# Usage:
#   CC_HUD_EXTRA_FILE="$HOME/.cache/cc-hud/ds-balance.txt" bash ds-hud-balance-cache.sh
#   or set DS_API_KEY env var, or it falls back to reading ANTHROPIC_AUTH_TOKEN

set -euo pipefail

CACHE_FILE="${CC_HUD_EXTRA_FILE:-$HOME/.cache/cc-hud/ds-balance.txt}"
API_KEY="${DS_API_KEY:-${ANTHROPIC_AUTH_TOKEN:-}}"
API_URL="https://api.deepseek.com/user/balance"

if [ -z "$API_KEY" ]; then
  echo "[cc-hud:ds-balance] DS_API_KEY or ANTHROPIC_AUTH_TOKEN not set" >&2
  exit 1
fi

# Ensure cache directory exists
mkdir -p "$(dirname "$CACHE_FILE")"

# Query balance
RESP=$(curl -s --noproxy '*' --max-time 5 "$API_URL" -H "Authorization: Bearer $API_KEY") || {
  echo "[cc-hud:ds-balance] API request failed" >&2
  exit 1
}

# Extract total_balance from first CNY entry
BAL=$(echo "$RESP" | grep -o '"total_balance":"[^"]*"' | head -1 | sed 's/.*"total_balance":"\([^"]*\)".*/\1/')

if [ -z "$BAL" ]; then
  echo "[cc-hud:ds-balance] failed to parse balance from response: $RESP" >&2
  exit 1
fi

echo "¥${BAL}" > "$CACHE_FILE"
echo "[cc-hud:ds-balance] cached: ¥${BAL} → $CACHE_FILE" >&2
