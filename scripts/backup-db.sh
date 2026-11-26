#!/usr/bin/env bash
# Backs up the production database to the media bucket under backups/db/, which is not public.
# Keeps the last 7 dumps on the server and the last 60 in the bucket. Run from the ciccbacend folder:
#
#   ./scripts/backup-db.sh
#
# Daily at 02:30, via `crontab -e`:
#   30 2 * * * cd /root/ciccbacend && ./scripts/backup-db.sh >> /var/log/cicc-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env.production ] || { echo "missing .env.production" >&2; exit 1; }

env_value() { grep -E "^$1=" .env.production | head -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//"; }
DB_URL="$(env_value DATABASE_URL | sed 's/?.*//')"
BUCKET="$(env_value S3_BUCKET)"
ENDPOINT="$(env_value S3_ENDPOINT)"
REGION="$(env_value S3_REGION)"
STAMP="$(date -u +%Y%m%d-%H%M)"
DIR=backups
FILE="$DIR/cicc-db-$STAMP.dump"
mkdir -p "$DIR"

# The client must be at least the server's version (Utho runs PostgreSQL 17).
docker run --rm postgres:17-alpine pg_dump --no-owner --no-privileges -Fc "$DB_URL" > "$FILE"
[ -s "$FILE" ] || { echo "backup is empty" >&2; rm -f "$FILE"; exit 1; }

aws() {
  docker run --rm -v "$PWD/$DIR":/backups \
    -e AWS_ACCESS_KEY_ID="$(env_value S3_ACCESS_KEY)" -e AWS_SECRET_ACCESS_KEY="$(env_value S3_SECRET_KEY)" -e AWS_DEFAULT_REGION="$REGION" \
    amazon/aws-cli --endpoint-url "$ENDPOINT" "$@"
}
aws s3 cp "/backups/$(basename "$FILE")" "s3://$BUCKET/backups/db/$(basename "$FILE")" --only-show-errors

ls -1t "$DIR"/cicc-db-*.dump | tail -n +8 | xargs -r rm -f
aws s3 ls "s3://$BUCKET/backups/db/" | awk '{print $4}' | sort | head -n -60 | while read -r old; do
  [ -n "$old" ] && aws s3 rm "s3://$BUCKET/backups/db/$old" --only-show-errors
done
echo "$(date -u +%FT%TZ) backup ok: $(basename "$FILE") ($(du -h "$FILE" | cut -f1))"
