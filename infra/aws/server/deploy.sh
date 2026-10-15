#!/bin/bash
# Lancé par GitHub Actions via SSM Run Command : deploy.sh <tag-image> <uri-depot-ecr> <bucket-ops>
set -euo pipefail
TAG="$1"
REPOSITORY="$2"
REGISTRY="${REPOSITORY%%/*}"
OPS_BUCKET="$3"
REGION=eu-west-3
cd /opt/nyanga

# Variables d'environnement depuis SSM (les valeurs secrètes ne quittent jamais AWS).
aws ssm get-parameters-by-path --region "$REGION" --path /nyanga/prod --with-decryption \
  --query 'Parameters[].[Name,Value]' --output text |
  while IFS=$'\t' read -r name value; do printf '%s=%s\n' "${name##*/}" "$value"; done > .env.new
echo "API_IMAGE=$REPOSITORY:$TAG" >> .env.new
chmod 600 .env.new && mv .env.new .env
echo "OPS_BUCKET=$OPS_BUCKET" > ops.env

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker compose pull
docker compose up -d --remove-orphans
# Recharge le Caddyfile s'il a changé (le conteneur ne redémarre pas sinon).
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true

# Sauvegarde quotidienne (installée une fois, mise à jour à chaque déploiement).
install -m 644 nyanga-backup.service nyanga-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now nyanga-backup.timer

for i in $(seq 1 40); do
  if docker compose exec -T api wget -qO- http://localhost:4000/api/health; then
    echo; echo "Déploiement $TAG OK"
    docker image prune -af --filter "until=168h" >/dev/null
    exit 0
  fi
  sleep 3
done
echo "L'API ne répond pas après le déploiement :"
docker compose logs --tail 80 api
exit 1
