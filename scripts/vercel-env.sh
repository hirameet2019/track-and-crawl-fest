#!/usr/bin/env bash
# Push the variables the app needs from .env.local into the linked Vercel project
# (production + preview). Values never pass through the chat; they are read from
# the local file and piped straight into the Vercel CLI.
#
# Usage:  bash scripts/vercel-env.sh https://your-deployment.vercel.app
set -euo pipefail
cd "$(dirname "$0")/.."

SITE_URL="${1:-}"
if [ -z "$SITE_URL" ]; then
  echo "Usage: bash scripts/vercel-env.sh <public site url>"; exit 1
fi

get() { grep -E "^$1=" .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

# NEXT_PUBLIC_* values ship to the browser anyway, so store them as plain Config;
# everything else is stored as a Secret (--sensitive) and cannot be read back.
push() {
  local name="$1" value="$2" kind="--sensitive"
  [ -z "$value" ] && { echo "skip $name (empty)"; return; }
  case "$name" in NEXT_PUBLIC_*|SMTP_HOST|SMTP_PORT|EMAIL_FROM) kind="--no-sensitive";; esac
  for env in production preview; do
    if ! printf '%s' "$value" | npx vercel env add "$name" "$env" --force --yes "$kind" >/dev/null 2>"$TMPDIR_ERR"; then
      echo "FAILED $name ($env):"; cat "$TMPDIR_ERR"; exit 1
    fi
  done
  echo "set  $name"
}
TMPDIR_ERR="$(mktemp)"

push NEXT_PUBLIC_SUPABASE_URL      "$(get NEXT_PUBLIC_SUPABASE_URL)"
push NEXT_PUBLIC_SUPABASE_ANON_KEY "$(get NEXT_PUBLIC_SUPABASE_ANON_KEY)"
push SUPABASE_SERVICE_ROLE_KEY     "$(get SUPABASE_SERVICE_ROLE_KEY)"
push NEXT_PUBLIC_SITE_URL          "$SITE_URL"
# Email is configured in Admin > Settings (database); env values are only a fallback.
push SMTP_HOST   "$(get SMTP_HOST)"
push SMTP_PORT   "$(get SMTP_PORT)"
push SMTP_USER   "$(get SMTP_USER)"
push SMTP_PASS   "$(get SMTP_PASS)"
push EMAIL_FROM  "$(get EMAIL_FROM)"
echo "done"
