#!/usr/bin/env bash
# Dump MongoDB to ./backups/cloudexec-<timestamp>.archive.gz (keeps the last 7).
# Cron it:  0 3 * * * cd ~/cloudExec && ./deploy/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
f="backups/cloudexec-$(date +%Y%m%d-%H%M%S).archive.gz"
docker compose -f docker-compose.prod.yml exec -T mongodb mongodump --db cloudexec --archive --gzip > "$f"
ls -1t backups/cloudexec-*.archive.gz | tail -n +8 | xargs -r rm --
echo "Backup written: $f ($(du -h "$f" | cut -f1))"
# Restore: docker compose -f docker-compose.prod.yml exec -T mongodb mongorestore --archive --gzip --drop < "$f"
