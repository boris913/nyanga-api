-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "slug" TEXT;
ALTER TABLE "Listing" ADD COLUMN "riskScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Listing" ADD COLUMN "riskReasons" JSONB;

-- Slug des annonces existantes : « <nom de profil ou titre>-<ville>-<6 derniers caractères de l'id> »,
-- sans accents, en minuscules, environ 60 caractères au plus (même format que src/lib/slug.ts).
UPDATE "Listing" AS l
SET "slug" = s.base || '-' || s.city || '-' || lower(right(l."id", 6))
FROM (
  SELECT
    l2."id",
    c."slug" AS city,
    COALESCE(
      NULLIF(
        btrim(
          left(
            btrim(
              regexp_replace(
                translate(
                  replace(replace(lower(COALESCE(NULLIF(btrim(u."displayName"), ''), l2."title")), 'œ', 'oe'), 'æ', 'ae'),
                  'àáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
                  'aaaaaaceeeeiiiinooooouuuuyy'
                ),
                '[^a-z0-9]+', '-', 'g'
              ),
              '-'
            ),
            GREATEST(60 - 7 - length(c."slug") - 1, 1)
          ),
          '-'
        ),
        ''
      ),
      'annonce'
    ) AS base
  FROM "Listing" AS l2
  JOIN "User" AS u ON u."id" = l2."userId"
  JOIN "City" AS c ON c."id" = l2."cityId"
) AS s
WHERE s."id" = l."id";

-- Collision improbable sur les 6 derniers caractères : on ajoute alors l'id complet.
UPDATE "Listing" AS l
SET "slug" = l."slug" || '-' || l."id"
WHERE EXISTS (SELECT 1 FROM "Listing" AS o WHERE o."slug" = l."slug" AND o."id" < l."id");

ALTER TABLE "Listing" ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Listing_slug_key" ON "Listing"("slug");
