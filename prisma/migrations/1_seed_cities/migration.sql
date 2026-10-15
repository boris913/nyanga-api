-- Villes de départ (identique à prisma/seed.ts) ; sans effet si elles existent déjà.
INSERT INTO "City" ("id", "slug", "name", "region") VALUES
  ('city_douala', 'douala', 'Douala', 'Littoral'),
  ('city_yaounde', 'yaounde', 'Yaoundé', 'Centre'),
  ('city_bafoussam', 'bafoussam', 'Bafoussam', 'Ouest'),
  ('city_bamenda', 'bamenda', 'Bamenda', 'Nord-Ouest'),
  ('city_buea', 'buea', 'Buea', 'Sud-Ouest'),
  ('city_limbe', 'limbe', 'Limbe', 'Sud-Ouest'),
  ('city_kribi', 'kribi', 'Kribi', 'Sud'),
  ('city_ebolowa', 'ebolowa', 'Ebolowa', 'Sud'),
  ('city_bertoua', 'bertoua', 'Bertoua', 'Est'),
  ('city_garoua', 'garoua', 'Garoua', 'Nord'),
  ('city_maroua', 'maroua', 'Maroua', 'Extrême-Nord'),
  ('city_ngaoundere', 'ngaoundere', 'Ngaoundéré', 'Adamaoua'),
  ('city_dschang', 'dschang', 'Dschang', 'Ouest'),
  ('city_kumba', 'kumba', 'Kumba', 'Sud-Ouest')
ON CONFLICT ("slug") DO NOTHING;
