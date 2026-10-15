# nyanga-api

API Fastify + Prisma (PostgreSQL) de Nyanga : comptes (email + mot de passe), annonces, messagerie, modération, paiements Chariow.

## Démarrer en local

```bash
cp .env.example .env          # renseigner JWT_SECRET (openssl rand -hex 32)
docker compose up -d db       # PostgreSQL sur le port 5432
npm install
npm run db:deploy && npm run db:seed
npm run dev                   # http://localhost:4000/api/health
npm test
```

## Administration

Nommer un modérateur administrateur (la personne doit avoir créé son compte) :

```bash
npm run admin:promote -- email@exemple.cm
```

## Fonctions désactivées pour le MVP

- Réinitialisation du mot de passe par email : `MAIL_DRIVER=none` (l'API répond 503).
- Connexion Google : `GOOGLE_CLIENT_ID` vide (l'API répond 503, le site masque le bouton).

## Paiements

Voir [docs/CHARIOW.md](docs/CHARIOW.md).
