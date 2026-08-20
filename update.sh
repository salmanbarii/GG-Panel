#!/usr/bin/env bash
set -euo pipefail

RED='\033[1;31m'
GRN='\033[1;32m'
YEL='\033[1;33m'
BLU='\033[1;34m'
RST='\033[0m'

info()  { printf "${BLU}[update]${RST} %s\n" "$*"; }
ok()    { printf "${GRN}[update] ✔${RST} %s\n" "$*"; }
warn()  { printf "${YEL}[update] ⚠${RST} %s\n" "$*"; }
die()   { printf "${RED}[update] ✖${RST} %s\n" "$*" >&2; exit 1; }

# ── resolve repo root (script dir) ───────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
info "Working directory: $(pwd)"

# ── args ─────────────────────────────────────────────────────────────────────
FORCE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE=true; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ── git dirty check ──────────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  warn "Working tree is dirty:"
  git status --short || true
  if [[ "$FORCE" = true ]]; then
    warn "Stashing local changes (--force passed)..."
    git stash || die "git stash failed"
    ok "Changes stashed"
  else
    die "Refusing to update with a dirty working tree. Pass --force to stash local changes."
  fi
else
  info "Working tree is clean"
fi

# ── git pull ─────────────────────────────────────────────────────────────────
info "Pulling latest changes (fast-forward only)..."
git pull --ff-only || die "git pull failed"
ok "Pull complete"

# ── npm install + build ──────────────────────────────────────────────────────
info "Installing dependencies..."
npm install --silent || die "npm install failed"
info "Building panel..."
npm run build || die "npm run build failed"
ok "Build complete"

# ── restart pm2 if present ───────────────────────────────────────────────────
if pm2 list | grep -q "gg-panel"; then
  info "Restarting gg-panel via pm2..."
  pm2 restart gg-panel --update-env
  ok "pm2 restart triggered"
else
  warn "pm2 process 'gg-panel' not found. Restart manually with: pm2 restart gg-panel --update-env"
fi

ok "Update finished successfully"
