# Website maintenance

Run on the server, from the `ciccbacend` folder. The helper below runs a script against the production settings in `.env.production`.

```bash
run() { docker run --rm -v "$PWD":/app -w /app -e NODE_ENV=production node:22-slim sh -c "npm ci --include=dev --no-audit --no-fund --loglevel=error >/dev/null && npx tsx $*"; }
```

## Daily (automatic)

Database backup to the bucket's private `backups/db/` folder. It keeps 60 backups there and 7 on the server.

```bash
crontab -e
# add this line:
30 2 * * * cd /root/ciccbacend && ./scripts/backup-db.sh >> /var/log/cicc-backup.log 2>&1
```

Check that it ran: `tail -3 /var/log/cicc-backup.log`

## Monthly checklist

| Task | How |
|---|---|
| Security scan of content and accounts | `run scripts/security-scan.ts`. A "Suspicious code" or "temporary password" finding needs action the same day. |
| Dependency vulnerabilities | `docker run --rm -v "$PWD":/app -w /app node:22-slim npm audit --omit=dev`, and the same in the frontend repo |
| Apply updates | Patch updates: `npm update`, then test locally, commit, push and `./deploy.sh` |
| Backups exist and restore | `tail /var/log/cicc-backup.log`, then restore the latest into a scratch database (below) |
| Website and API answer | `curl -fsS https://api.council-icc.org/api/health` and open https://council-icc.org |
| Forms and registrations work | Send a test enquiry from Contact Us and delete it in Admin → Enquiries |
| Accounts | Admin → Accounts: disable anyone who has left |
| Server | `df -h` (keep 5 GB free), `docker image prune -f`, `apt-get update && apt-get upgrade -y` |
| Logs | `docker compose -f docker-compose.prod.yml logs --since 720h api \| grep -i error \| tail` |

## Availability monitoring

Add `https://api.council-icc.org/api/health` and `https://council-icc.org` to an uptime monitor such as UptimeRobot, alerting by email. The health check reports `"database":"down"` if the database is unreachable.

## Restoring a backup

Never restore over the live database without a fresh backup first. To test a backup, restore it into a scratch database:

```bash
docker run -d --name restore-test -e POSTGRES_PASSWORD=test postgres:17-alpine
docker cp backups/<file>.dump restore-test:/tmp/b.dump
docker exec restore-test pg_restore -U postgres -d postgres --no-owner /tmp/b.dump
docker exec restore-test psql -U postgres -c 'select count(*) from "Page"'
docker rm -f restore-test
```

## Content corrections

`run scripts/content-updates.ts` re-applies the agreed corrections: program period 2026–2036, copyright notice, CICC colours and the official MHQ team. It is safe to repeat, and `npm run import:site` runs it automatically.

## Confidentiality

Publicly, only the President is named. Every other governance body shows only the countries of its members. The security scan reports any other person's name found in published pages, events or posts, as `Confidential name … published`. Remove it the same day.

## Admin accounts

- Admin → Accounts creates individual accounts. **Administrators** manage content and accounts; **editors** manage content only.
- Disabling an account or changing its role takes effect immediately.
- There is always at least one active administrator: the last one can't be disabled or demoted.
