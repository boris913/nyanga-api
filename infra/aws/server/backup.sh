#!/bin/bash
# Sauvegarde PostgreSQL vers s3://<bucket-ops>/backups/ (conservée 30 jours par la règle de cycle de vie).
set -euo pipefail
cd /opt/nyanga
source ops.env
docker compose exec -T db pg_dump -U nyanga -Fc nyanga |
  aws s3 cp - "s3://$OPS_BUCKET/backups/nyanga-$(date -u +%Y-%m-%dT%H%M).dump" --region eu-west-3
