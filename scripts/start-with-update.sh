#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

info() { printf "\033[1;34m[panel]${RST} %s\n" "$*"; }
die()  { printf "\033[1;31m[panel] ✖${RST} %s\n" "$*" >&2; exit 1; }

cd "$REPO_DIR"
info "Repo root: $REPO_DIR"

# ── check if git remote is reachable ─────────────────────────────────────────
UPSTREAM=""
if git remote >/dev/null 2>&1; then
  REMOTE="$(git remote 2>/dev/null | head -n1 || echo "")"
  if [[ -n "$REMOTE" ]]; then
    info "Checking upstream availability..."
    if git fetch --quiet "$REMOTE" >/dev/null 2>&1; then
      UPSTREAM="$REMOTE/$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
      info "Upstream detected: $UPSTREAM"
    else
      warn "Cannot reach upstream remote '$REMOTE'. Skipping auto-update."
    fi
  else
    warn "No git remotes configured. Skipping auto-update."
  fi
else
  warn "Not a git repository. Skipping auto-update."
fi

# ── run update if behind ──────────────────────────────────────────────────────
if [[ -n "$UPSTREAM" ]]; then
  BEHIND="$(git rev-list --count HEAD.."$UPSTREAM" 2>/dev/null || echo 0)"
  if [[ "$BEHIND" -gt 0 ]]; then
    info "Local branch is ${BEHIND} commit(s) behind upstream. Running update..."
    bash "$SCRIPT_DIR/update.sh" || warn "Update script failed; continuing with current build."
  else
    info "Local branch is up-to-date with upstream."
  fi
fi

# ── start panel ──────────────────────────────────────────────────────────────
info "Starting panel..."
exec npm run start
