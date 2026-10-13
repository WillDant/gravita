#!/bin/sh
# Gravita Deep Observe: forwards one Claude Code hook (its JSON on stdin) to the Gravita
# engine on 127.0.0.1, or spools it to disk when the engine can't be reached.
#
# Observe only. This script must never change what Claude Code does, so it:
#   - prints nothing on stdout (stdout of SessionStart and UserPromptSubmit would reach the
#     model) and nothing on stderr,
#   - always exits 0 (non-zero shows a hook error; 2 would block the tool),
#   - gives up on the engine after 0.4 s (the hooks also run async),
#   - writes only under Gravita's own folder, ${GRAVITA_HOME:-$HOME/.gravita}: never in the
#     plugin folder, never under ~/.claude.
# The hook token is read from Gravita's runtime file and passed to curl on a file
# descriptor, never on the command line (where other users could see it in `ps`).

# Sessions Gravita runs itself are observed directly.
[ "${GRAVITA_MANAGED:-}" = "1" ] && exit 0

SPOOL_MAX_BYTES=5242880

post() {
  printf '%s' "$payload" | curl -s -o /dev/null -w '%{http_code}' -m 0.4 \
    --data-binary @- -H 'Content-Type: application/json' -H @/dev/fd/3 \
    "http://127.0.0.1:$port/hooks" 3<<EOF
Authorization: Bearer $token
EOF
}

forward() {
  payload=$(cat) || return 0
  [ -n "$payload" ] || return 0
  [ -n "${GRAVITA_HOME:-}${HOME:-}" ] || return 0
  home=${GRAVITA_HOME:-$HOME/.gravita}

  status=000
  runtime="$home/runtime.json"
  if [ -r "$runtime" ] && command -v curl >/dev/null 2>&1; then
    info=$(cat "$runtime")
    port=$(printf '%s' "$info" |
      sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
    token=$(printf '%s' "$info" |
      sed -n 's/.*"hookToken"[[:space:]]*:[[:space:]]*"\([0-9A-Za-z]*\)".*/\1/p' | head -n 1)
    if [ -n "$port" ] && [ -n "$token" ]; then
      status=$(post) || status=000
    fi
  fi
  # Delivered, or refused for good (too large, not JSON): nothing to keep.
  case $status in
    2??|400|413) return 0 ;;
  esac

  # Unreachable, stale runtime file, or failing: keep it for the next engine (one line).
  umask 077
  spool="$home/spool"
  mkdir -p "$spool" || return 0
  file="$spool/hooks.jsonl"
  if [ -f "$file" ]; then
    size=$(wc -c <"$file" | tr -d ' ')
    [ "${size:-0}" -lt "$SPOOL_MAX_BYTES" ] || return 0
  fi
  line=$(printf '%s' "$payload" | tr -d '\r\n' | sed 's/^[[:space:]]*//')
  case $line in
    '{}') return 0 ;;
    '{'*) line="{\"gravita_spooled_at\":$(date +%s),${line#?}" ;;
    *) return 0 ;;
  esac
  printf '%s\n' "$line" >>"$file"
}

forward >/dev/null 2>&1
exit 0
