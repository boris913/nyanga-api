# Paiements Chariow

## Produits à créer dans Chariow

| SKU | Type Chariow | Prix affiché | Variable |
|---|---|---|---|
| PREMIUM | Licence 30 jours | 2 500 FCFA | `CHARIOW_PRODUCT_PREMIUM` |
| VIP | Licence 30 jours | 7 500 FCFA | `CHARIOW_PRODUCT_VIP` |
| BUMP | Produit simple | 500 FCFA | `CHARIOW_PRODUCT_BUMP` |
| FEATURED_24H | Produit simple | 1 500 FCFA | `CHARIOW_PRODUCT_FEATURED_24H` |
| FEATURED_7D | Produit simple | 5 000 FCFA | `CHARIOW_PRODUCT_FEATURED_7D` |

Les prix affichés sur le site viennent de `src/lib/plans.ts` : ils doivent rester identiques à ceux saisis dans Chariow. Un produit dont la variable est vide apparaît comme indisponible.

## Pulse (webhook)

- URL : `https://<api>/api/webhooks/chariow`
- Événements : `successful.sale`, `license.issued`, `license.activated`, `license.nearing_expiry`, `license.expired`, `license.revoked`
- Copier le secret de signature dans `CHARIOW_PULSE_SECRET`. Sans lui, tous les Pulses sont refusés (401).

## Comportement

- L'accès n'est jamais accordé au retour du paiement, uniquement à réception d'un Pulse signé.
- Chaque livraison est enregistrée (`PulseDelivery`) : un doublon est ignoré, une livraison en échec peut être rejouée depuis l'onglet Deliveries de Chariow.
- Le rattachement au compte se fait par `custom_metadata.user_id` sur la vente, puis par email pour les Pulses `license.*`.
- Produit inconnu, email ou clé de licence absents : rien n'est accordé.
