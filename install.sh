#!/usr/bin/env bash
set -euo pipefail

PANEL_VERSION="1.0.0"
SCRIPT_NAME="install.sh"

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[1;31m'
GRN='\033[1;32m'
YEL='\033[1;33m'
BLU='\033[1;34m'
RST='\033[0m'

log()  { printf "${BLU}[panel]${RST} %s\n" "$*"; }
ok()   { printf "${GRN}[panel] ✔${RST} %s\n" "$*"; }
warn() { printf "${YEL}[panel] ⚠${RST} %s\n" "$*"; }
die()  { printf "${RED}[panel] ✖${RST} %s\n" "$*" >&2; exit 1; }

# ── helpers ──────────────────────────────────────────────────────────────────
is_true() { [[ "$1" =~ ^(y|yes|true|1)$ ]]; }
prompt_yes() {
  local prompt="$1" default="$2"
  local yn
  if [[ "$default" =~ ^(y|yes)$ ]]; then
    yn="Y/n"
  else
    yn="y/N"
  fi
  read -rp "$(printf "${YEL}[panel]${RST} %s [%s] " "$prompt" "$yn") " yn
  yn="${yn:-$default}"
  is_true "$yn"
}

# ── re-exec as root if needed ─────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    log "Re-executing with sudo..."
    exec sudo bash "$0" "$@"
  else
    die "This installer must be run as root. Please re-run with sudo."
  fi
fi

# ── args ─────────────────────────────────────────────────────────────────────
NON_INTERACTIVE=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive|-y)
      NON_INTERACTIVE=true
      shift
      ;;
    --force-docker)
      FORCE_DOCKER=true
      shift
      ;;
    *)
      die "Unknown option: $1"
      ;;
  esac
done

log "GG Panel installer v${PANEL_VERSION}"
if [[ "$NON_INTERACTIVE" = true ]]; then
  log "Non-interactive mode enabled (-y)"
fi

# ── OS / arch detection ──────────────────────────────────────────────────────
log "Detecting OS and architecture..."
OS="$(. /etc/os-release 2>/dev/null && echo "$ID" || echo "unknown")"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  armv7l) ARCH="armv7" ;;
  *) die "Unsupported architecture: $ARCH" ;;
esac
log "OS=${OS} ARCH=${ARCH}"

# ── base packages ────────────────────────────────────────────────────────────
log "Installing base packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git unzip ca-certificates gnupg build-essential apt-transport-https >/dev/null 2>&1 \
  || apt-get install -y -qq curl git unzip ca-certificates gnupg build-essential >/dev/null
ok "Base packages installed"

# ── Node.js 20+ ──────────────────────────────────────────────────────────────
log "Checking Node.js..."
NODE_VERSION="$(node -v 2>/dev/null | sed 's/^v//' || echo "0")"
NEED_NODE=false
if ! command -v node >/dev/null 2>&1; then
  log "Node.js not found; installing Node.js 20.x via NodeSource..."
  NEED_NODE=true
elif [[ "$(printf '%s\n' "20.0.0" "$NODE_VERSION" | sort -V | head -n1)" != "20.0.0" ]]; then
  log "Node.js v${NODE_VERSION} is too old; upgrading to Node.js 20.x via NodeSource..."
  NEED_NODE=true
fi

if [[ "$NEED_NODE" = true ]]; then
  if [[ "$OS" = "ubuntu" || "$OS" = "debian" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
    apt-get install -y -qq nodejs >/dev/null
    NODE_VERSION="$(node -v | sed 's/^v//')"
    ok "Node.js v${NODE_VERSION} installed"
  else
    warn "Automatic Node.js install not supported on ${OS}. Please install Node.js >= 20 manually."
  fi
else
  ok "Node.js v${NODE_VERSION} is present"
fi

# ── Docker ───────────────────────────────────────────────────────────────────
INSTALL_DOCKER=false
if [[ "${FORCE_DOCKER:-false}" = true ]]; then
  INSTALL_DOCKER=true
elif [[ "$NON_INTERACTIVE" = true ]]; then
  INSTALL_DOCKER=true
else
  if prompt_yes "Install Docker Engine?" "y"; then
    INSTALL_DOCKER=true
  fi
fi

if [[ "$INSTALL_DOCKER" = true ]]; then
  log "Installing Docker Engine..."
  curl -fsSL https://get.docker.com | sh - >/dev/null 2>&1
  systemctl enable --now docker >/dev/null 2>&1 || true
  ok "Docker installed and service enabled"
else
  warn "Skipping Docker installation"
fi

# ── Java runtimes ────────────────────────────────────────────────────────────
log "Installing Java runtimes (local runtime)..."
JAVA_PKGS="openjdk-8-jre-headless openjdk-11-jre-headless openjdk-17-jre-headless openjdk-21-jre-headless"
JAVA_INSTALLED=""
for pkg in $JAVA_PKGS; do
  if apt-cache show "$pkg" >/dev/null 2>&1; then
    if apt-get install -y -qq "$pkg" >/dev/null 2>&1; then
      log "  → ${pkg} installed"
      JAVA_INSTALLED="${JAVA_INSTALLED} ${pkg}"
    else
      warn "  → ${pkg} unavailable on this system"
    fi
  else
    warn "  → ${pkg} not in apt cache (skipping)"
  fi
done
if [[ -z "$JAVA_INSTALLED" ]]; then
  warn "No Java runtimes installed; local Minecraft servers will need manual setup."
else
  ok "Java runtimes installed:${JAVA_INSTALLED}"
fi

# ── prompts ──────────────────────────────────────────────────────────────────
if [[ "$NON_INTERACTIVE" = true ]]; then
  PANEL_PORT=6767
  SFTP_PORT=6868
  DEFAULT_RUNTIME="docker"
else
  read -rp "$(printf "${YEL}[panel]${RST} Panel HTTP port [6767]: ")" PANEL_PORT
  PANEL_PORT="${PANEL_PORT:-6767}"
  read -rp "$(printf "${YEL}[panel]${RST} SFTP port [6868]: ")" SFTP_PORT
  SFTP_PORT="${SFTP_PORT:-6868}"
  read -rp "$(printf "${YEL}[panel]${RST} Default runtime (docker|local) [docker]: ")" DEFAULT_RUNTIME
  DEFAULT_RUNTIME="${DEFAULT_RUNTIME:-docker}"
fi

# validate
if ! [[ "$PANEL_PORT" =~ ^[0-9]+$ ]] || [[ "$PANEL_PORT" -lt 1 || "$PANEL_PORT" -gt 65535 ]]; then
  die "Invalid panel port: ${PANEL_PORT}"
fi
if ! [[ "$SFTP_PORT" =~ ^[0-9]+$ ]] || [[ "$SFTP_PORT" -lt 1 || "$SFTP_PORT" -gt 65535 ]]; then
  die "Invalid SFTP port: ${SFTP_PORT}"
fi
if [[ "$DEFAULT_RUNTIME" != "docker" && "$DEFAULT_RUNTIME" != "local" ]]; then
  die "Invalid runtime: ${DEFAULT_RUNTIME} (must be docker or local)"
fi

# ── JWT secret ───────────────────────────────────────────────────────────────
log "Generating JWT secret..."
JWT_SECRET="$(openssl rand -hex 32)"

# ── .env ─────────────────────────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  log "Existing .env found — backing up to .env.bak"
  cp -f .env .env.bak
  if [[ "$NON_INTERACTIVE" = false ]]; then
    read -rp "$(printf "${YEL}[panel]${RST} Overwrite existing .env? [y/N] ")" overwrite_env
    if ! [[ "$overwrite_env" =~ ^[Yy]$ ]]; then
      log "Skipping .env generation; using existing file."
      log "Edit it manually to set PORT, JWT_SECRET, etc."
    else
      WRITE_ENV=true
    fi
  else
    WRITE_ENV=true
  fi
else
  WRITE_ENV=true
fi

if [[ "${WRITE_ENV:-false}" = true ]]; then
  log "Writing .env..."
  cat > .env <<EOF
# Generated by GG Panel installer on $(date -u +%Y-%m-%dT%H:%M:%SZ)
PORT=${PANEL_PORT}
JWT_SECRET=${JWT_SECRET}
ENABLE_DOCKER=${INSTALL_DOCKER}
DOCKER_SOCKET_PATH=/var/run/docker.sock
DEFAULT_RUNTIME=${DEFAULT_RUNTIME}
PANEL_RUNTIME_LOCKED=false
SFTP_PORT=${SFTP_PORT}
GEMINI_API_KEY=
GITHUB_WEBHOOK_SECRET=
NODE_ENV=production
EOF
  ok ".env written"
fi

# ── npm install + build ──────────────────────────────────────────────────────
log "Running npm install..."
npm install --silent
log "Building panel..."
npm run build
ok "Build complete"

# ── .data directory ──────────────────────────────────────────────────────────
log "Creating data directories..."
mkdir -p .data/servers .data/backups .data/ssh .data/logs .data/jars .data/tmp
ok "Data directories created at $(pwd)/.data"

# ── initial admin ────────────────────────────────────────────────────────────
if [[ "$NON_INTERACTIVE" = true ]]; then
  log "Non-interactive mode — skipping owner account creation."
  log "Create one later with: npm run createuser -- --username <u> --password <p> --role owner"
else
  if prompt_yes "Create initial owner account now?" "y"; then
    read -rp "Username: " ADMIN_USER
    while [[ ${#ADMIN_USER} -lt 3 ]]; do
      warn "Username must be at least 3 characters."
      read -rp "Username: " ADMIN_USER
    done
    read -rsp "Password: " ADMIN_PASS
    echo
    while [[ ${#ADMIN_PASS} -lt 6 ]]; do
      warn "Password must be at least 6 characters."
      read -rsp "Password: " ADMIN_PASS
      echo
    done
    npm run createuser -- --username "$ADMIN_USER" --password "$ADMIN_PASS" --role owner
    ok "Owner account created"
  else
    log "Skipping owner account creation."
  fi
fi

# ── ufw ──────────────────────────────────────────────────────────────────────
CONFIGURE_UFW=false
if [[ "$NON_INTERACTIVE" = true ]]; then
  CONFIGURE_UFW=false
else
  if prompt_yes "Configure UFW firewall rules?" "n"; then
    CONFIGURE_UFW=true
  fi
fi

if [[ "$CONFIGURE_UFW" = true ]]; then
  if command -v ufw >/dev/null 2>&1; then
    log "Configuring UFW..."
    ufw allow ssh/tcp >/dev/null 2>&1 || true
    ufw allow "${PANEL_PORT}/tcp" >/dev/null 2>&1 || true
    ufw allow "${SFTP_PORT}/tcp" >/dev/null 2>&1 || true
    ufw allow 25565:25600/tcp >/dev/null 2>&1 || true
    ufw allow 25565:25600/udp >/dev/null 2>&1 || true
    ufw --force enable >/dev/null 2>&1 || true
    ok "UFW configured and enabled"
  else
    warn "UFW is not installed. Install it with: apt-get install -y ufw"
  fi
else
  warn "Skipping UFW configuration"
fi

# ── pm2 ──────────────────────────────────────────────────────────────────────
log "Installing pm2..."
npm install -g pm2@latest >/dev/null 2>&1 || true
ok "pm2 installed"

log "Starting panel via pm2..."
pm2 start npm --name "gg-panel" -- run start
pm2 save
log "Configuring pm2 startup..."
pm2 startup | tail -n 1 >/tmp/pm2_startup.sh || true
bash /tmp/pm2_startup.sh >/dev/null 2>&1 || true
ok "pm2 configured"

# ── summary ──────────────────────────────────────────────────────────────────
HOSTNAME_STR="$(hostname -I | awk '{print $1}')"
cat <<EOF

${GRN}═══════════════════════════════════════════════════════${RST}
${GRN} GG Panel installation complete!${RST}
${GRN}═══════════════════════════════════════════════════════${RST}

  Access URL : ${BLU}http://${HOSTNAME_STR}:${PANEL_PORT}${RST}
  SFTP port  : ${SFTP_PORT}
  Data dir   : $(pwd)/.data
  Env file   : $(pwd)/.env

  Useful pm2 commands:
    pm2 list              — view processes
    pm2 logs gg-panel    — view logs
    pm2 restart gg-panel — restart after config change
    pm2 stop gg-panel    — stop the panel

${YEL}If you did not create an owner account, run:${RST}
  npm run createuser -- --username <u> --password <p> --role owner

${GRN}═══════════════════════════════════════════════════════${RST}
EOF
