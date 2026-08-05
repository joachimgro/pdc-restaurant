#!/usr/bin/env bash
# Put Worker secrets from a gitignored secrets.env (KEY=value per line).
# Usage: ./scripts/put-secrets.sh [path/to/secrets.env]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="${1:-$ROOT/workers/api/secrets.env}"
API="$ROOT/workers/api"

if [[ ! -f "$FILE" ]]; then
  echo "Missing $FILE"
  echo "Create it with KEY=value lines (RESEND_API_KEY, TELNYX_*, …) — never commit it."
  exit 1
fi

cd "$API"
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  key="$(echo "$key" | xargs)"
  [[ -z "$key" ]] && continue
  echo "→ $key"
  printf '%s' "$val" | pnpm exec wrangler secret put "$key"
done < "$FILE"

echo "✓ Secrets applied to Worker $(grep '^name' wrangler.toml | head -1)"
