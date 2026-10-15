# Production AWS (eu-west-3)

Pile CloudFormation `nyanga-prod` (compte 168692730521, [template.yaml](template.yaml)) :

- **CloudFront** : HTTPS public. `/api/*` va vers le serveur EC2, `listings/*` vers le bucket photos.
- **EC2 t3.micro** `nyanga-api` : Docker avec PostgreSQL 16 et l'API ([server/compose.yml](server/compose.yml)). Le port 80 n'est ouvert qu'à CloudFront, et l'API exige en plus l'en-tête secret `X-Origin-Verify`. Il n'y a pas de SSH : l'administration passe par SSM.
- **Volume EBS** `nyanga-postgres`, monté sur `/data` : il garde les données de la base, même si le serveur est remplacé.
- **S3** :
  - bucket photos privé ;
  - bucket ops, avec les fichiers de déploiement et les sauvegardes quotidiennes à 02:00 UTC, gardées 30 jours.
- **ECR** `nyanga-api` : les images Docker.

## Déploiement

Chaque push sur `main` lance [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) :

1. les tests ;
2. la construction de l'image et son envoi vers ECR ;
3. l'exécution de `deploy.sh` sur le serveur via SSM.

Les migrations Prisma s'appliquent au démarrage de l'API. On peut aussi relancer un déploiement à la main : onglet Actions, puis « Run workflow ».

Variables du dépôt GitHub (pas des secrets) : `AWS_DEPLOY_ROLE_ARN`, `ECR_REPOSITORY_URI`, `OPS_BUCKET`, `INSTANCE_ID` (sorties de la pile).

## Configuration

`deploy.sh` écrit le fichier `.env` de l'API à partir de tous les paramètres SSM `/nyanga/prod/*`. Pour modifier la configuration :

1. Créez ou modifiez le paramètre dans la console : **Systems Manager**, puis **Magasin de paramètres**. Les secrets se créent en type `SecureString`.
2. Relancez un déploiement.

| Paramètre | Rôle |
|---|---|
| `JWT_SECRET`, `POSTGRES_PASSWORD`, `ORIGIN_SECRET` | Générés à l'installation, ne pas modifier |
| `WEB_URL` | URL du site Vercel (CORS, retour après paiement) |
| `S3_BUCKET`, `MEDIA_PUBLIC_URL` | Bucket photos et URL CloudFront |
| `MAIL_DRIVER` | `none` pour le MVP |
| `CHARIOW_API_KEY`, `CHARIOW_PULSE_SECRET` | SecureString, voir [docs/CHARIOW.md](../../docs/CHARIOW.md) |
| `CHARIOW_PRODUCT_*` | Identifiants des produits Chariow |

Si vous changez `WEB_URL`, mettez à jour le paramètre `WebOrigin` de la pile (CORS du bucket photos).

## Opérations courantes

Ouvrir une session sur le serveur : **EC2**, puis **Instances**, `nyanga-api`, **Se connecter**, **Session Manager**. Ensuite :

```bash
sudo -i && cd /opt/nyanga
docker compose ps
docker compose logs --tail 100 api
# Nommer un administrateur (la personne doit avoir créé son compte) :
docker compose exec -T db psql -U nyanga -c "UPDATE \"User\" SET role='ADMIN' WHERE email='prenom@exemple.cm'"
# Sauvegarde immédiate :
systemctl start nyanga-backup.service
```

Restaurer une sauvegarde (cela écrase la base) :

```bash
aws s3 cp s3://<bucket-ops>/backups/<fichier>.dump /tmp/restore.dump
docker compose exec -T db pg_restore -U nyanga -d nyanga --clean --if-exists < /tmp/restore.dump
```
