#!/usr/bin/env bash
# One-time setup for a fresh Ubuntu 22.04/24.04 VM (AWS, GCP, Azure, Oracle, DigitalOcean…).
#   curl -fsSL https://raw.githubusercontent.com/CLOVEOS/cloudExec/main/deploy/setup-vm.sh | bash
set -euo pipefail
GVISOR_OK=""

REPO_URL="${REPO_URL:-https://github.com/CLOVEOS/cloudExec.git}"
APP_DIR="${APP_DIR:-$HOME/cloudExec}"

echo "==> Installing Docker Engine + Compose plugin"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"
sudo systemctl enable --now docker

echo "==> gVisor (runsc): user code runs on a user-space kernel, not the host kernel"
if [ "${INSTALL_GVISOR:-1}" = "1" ] && ! command -v runsc >/dev/null; then
  (
    set -e
    sudo apt-get update -y && sudo apt-get install -y apt-transport-https ca-certificates curl gnupg
    curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
      | sudo tee /etc/apt/sources.list.d/gvisor.list >/dev/null
    sudo apt-get update -y && sudo apt-get install -y runsc
    sudo runsc install
    sudo systemctl restart docker
  ) && GVISOR_OK=1 || echo "⚠️  gVisor install failed — sandboxes will use the default runc runtime"
fi

echo "==> Firewall: allow SSH, HTTP, HTTPS only"
if command -v ufw >/dev/null; then
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 443/udp
  sudo ufw --force enable
fi

echo "==> Swap (Spark + Kafka + Mongo like headroom on small VMs)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> Fetching the app"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
[ -f .env ] || cp .env.example .env

PUBLIC_IP="$(curl -fsS https://api.ipify.org || true)"
cat <<MSG

✅ VM ready. Next:
  1. Log out and back in (so 'docker' works without sudo).
  2. Edit $APP_DIR/.env and set:
       SARVAM_API_KEY, JWT_SECRET (openssl rand -hex 32), ADMIN_EMAILS, ACME_EMAIL
       DOMAIN=${PUBLIC_IP:+${PUBLIC_IP//./-}.sslip.io}
       SANDBOX_RUNTIME=${GVISOR_OK:+runsc}   (leave empty if gVisor isn't installed)   (or your own domain pointing at ${PUBLIC_IP:-this VM})
  3. cd $APP_DIR && ./deploy/deploy.sh
MSG
