# Paiements Chariow

## Produits à créer dans Chariow

| Nom du produit | Type Chariow | Prix | Paramètre SSM `/nyanga/prod/…` |
|---|---|---|---|
| Nyanga Premium | Licence, expiration 30 jours | 2 500 FCFA | `CHARIOW_PRODUCT_PREMIUM` |
| Nyanga VIP | Licence, expiration 30 jours | 7 500 FCFA | `CHARIOW_PRODUCT_VIP` |
| Remontée en tête de liste | Achat unique | 500 FCFA | `CHARIOW_PRODUCT_BUMP` |
| À la une 24 h | Achat unique | 1 500 FCFA | `CHARIOW_PRODUCT_FEATURED_24H` |
| À la une 7 jours | Achat unique | 5 000 FCFA | `CHARIOW_PRODUCT_FEATURED_7D` |

Les prix affichés sur le site viennent de `src/lib/plans.ts` : ils doivent rester identiques à ceux saisis dans Chariow. Un produit dont l'identifiant n'est pas renseigné apparaît comme « Bientôt disponible ».

Les clés vont dans le magasin de paramètres SSM (voir `infra/aws/README.md`) : `CHARIOW_API_KEY` et `CHARIOW_PULSE_SECRET` en `SecureString`, les identifiants de produits en `String`, puis relancer un déploiement.

## Pulse (webhook)

- URL : `<ApiUrl de la pile nyanga-prod>/api/webhooks/chariow`
- Événements : `successful.sale`, `license.issued`, `license.activated`, `license.nearing_expiry`, `license.expired`, `license.revoked`
- Copier le secret de signature dans `CHARIOW_PULSE_SECRET`. Sans lui, tous les Pulses sont refusés (401).

## Comportement

- L'accès n'est jamais accordé au retour du paiement, uniquement à réception d'un Pulse signé.
- Chaque livraison est enregistrée (`PulseDelivery`) : un doublon est ignoré, une livraison en échec peut être rejouée depuis l'onglet Deliveries de Chariow.
- Le rattachement au compte se fait par `custom_metadata.user_id` sur la vente, puis par email pour les Pulses `license.*`.
- Produit inconnu, email ou clé de licence absents : rien n'est accordé.
