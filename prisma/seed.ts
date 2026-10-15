import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CITIES = [
  { slug: 'douala', name: 'Douala', region: 'Littoral' },
  { slug: 'yaounde', name: 'Yaoundé', region: 'Centre' },
  { slug: 'bafoussam', name: 'Bafoussam', region: 'Ouest' },
  { slug: 'bamenda', name: 'Bamenda', region: 'Nord-Ouest' },
  { slug: 'buea', name: 'Buea', region: 'Sud-Ouest' },
  { slug: 'limbe', name: 'Limbe', region: 'Sud-Ouest' },
  { slug: 'kribi', name: 'Kribi', region: 'Sud' },
  { slug: 'ebolowa', name: 'Ebolowa', region: 'Sud' },
  { slug: 'bertoua', name: 'Bertoua', region: 'Est' },
  { slug: 'garoua', name: 'Garoua', region: 'Nord' },
  { slug: 'maroua', name: 'Maroua', region: 'Extrême-Nord' },
  { slug: 'ngaoundere', name: 'Ngaoundéré', region: 'Adamaoua' },
  { slug: 'dschang', name: 'Dschang', region: 'Ouest' },
  { slug: 'kumba', name: 'Kumba', region: 'Sud-Ouest' },
];

async function main() {
  for (const c of CITIES) {
    await prisma.city.upsert({ where: { slug: c.slug }, update: c, create: c });
  }
  console.log(`${CITIES.length} villes en base`);
}

main().finally(() => prisma.$disconnect());
