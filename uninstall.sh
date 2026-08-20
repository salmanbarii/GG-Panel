#!/usr/bin/env bash
set -euo pipefail

RED='\033[1;31m'
GRN='\033[1;32m'
YEL='\033[1;33m'
BLU='\033[1;34m'
RST='\033[0m'

info()  { printf "${BLU}[uninstall]${RST} %s\n" "$*"; }
ok()    { printf "${GRN}[uninstall] ✔${RST} %s\n" "$*"; }
warn()  { printf "${YEL}[uninstall] ⚠${RST} %s\n" "$*"; }
die()   { printf "${RED}[uninstall] ✖${RST} %s\n" "$*" >&2; exit 1; }

# ── args ─────────────────────────────────────────────────────────────────────
YES=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    -y|--yes) YES=true; shift ;;
    *) die "Unknown option: $1" ;;
  esac
done

if [[ "$YES" = true ]]; then
  info "Non-interactive mode — assuming confirmation."
else
  printf "${YEL}[uninstall]${RST} This will remove the JTG Panel service and build artifacts. "
  printf "Data in .data/ and .env will NOT be deleted.\n"
  read -rp "Continue? [y/N] " yn
  if ! [[ "$yn" =~ ^[Yy]$ ]]; then
    die "Uninstall cancelled by user."
  fi
fi

# ── pm2 ──────────────────────────────────────────────────────────────────────
if pm2 list | grep -q "jtg-panel"; then
  info "Stopping and deleting jtg-panel from pm2..."
  pm2 delete jtg-panel
  pm2 save
  ok "pm2 process removed"
else
  warn "pm2 process 'jtg-panel' not found — skipping."
fi

# ── docker containers ────────────────────────────────────────────────────────
info "Scanning for jtg-* Docker containers..."
CONTAINERS="$(docker ps -aq --filter "name=^jtg-" --filter "label=jtg.panel=true" 2>/dev/null || echo "")"
if [[ -n "$CONTAINERS" ]]; then
  if [[ "$YES" = true ]]; then
    STOP_DOCKER=true
  else
    read -rp "Stop and remove Docker containers matching jtg-* (label jtg.panel=true)? [y/N] " yn
    STOP_DOCKER=false
    [[ "$yn" =~ ^[Yy]$ ]] && STOP_DOCKER=true
  fi

  if [[ "$STOP_DOCKER" = true ]]; then
    info "Stopping containers..."
    docker stop $CONTAINERS >/dev/null 2>&1 || true
    info "Removing containers..."
    docker rm $CONTAINERS >/dev/null 2>&1 || true
    ok "Docker containers removed"
  else
    warn "Skipping Docker container removal."
  fi
else
  info "No matching Docker containers found."
fi

# ── remove build artifacts ───────────────────────────────────────────────────
info "Removing node_modules/ and dist/..."
rm -rf node_modules dist
ok "Build artifacts removed"

# ── preserve data ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
printf "\n${GRN}═══════════════════════════════════════════════════════${RST}\n"
printf "${GRN}  Your data and configuration are preserved:${RST}\n"
printf "${GRN}═══════════════════════════════════════════════════════${RST}\n\n"
printf "  Data dir : %s/.data\n" "$SCRIPT_DIR"
printf "  Env file : %s/.env\n" "$SCRIPT_DIR"
printf "\n  To back up before reinstalling, copy these directories/files.\n\n"

# ── summary ──────────────────────────────────────────────────────────────────
ok "Uninstall complete. Reinstall with: bash install.sh"
