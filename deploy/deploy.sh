#!/usr/bin/env bash
# Pull the latest code and (re)start the production stack. Safe to run repeatedly.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"

[ -f .env ] || { echo "Missing .env — copy .env.example and fill it in"; exit 1; }

if [ "${SKIP_PULL:-}" != "1" ]; then
  git pull --ff-only
fi

$COMPOSE build
$COMPOSE up -d --remove-orphans
docker image prune -f >/dev/null

echo "Waiting for the API to report ready…"
for i in $(seq 1 30); do
  if $COMPOSE exec -T api node -e "fetch('http://localhost:8000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "✅ Deployed: https://$(grep -E '^DOMAIN=' .env | cut -d= -f2)"
    $COMPOSE ps
    exit 0
  fi
  sleep 5
done
echo "❌ API did not become ready; recent logs:"
$COMPOSE logs --tail 50 api
exit 1
