import type { FastifyPluginAsync } from 'fastify';

export const cityRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    const cities = await app.prisma.city.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { listings: { where: { status: 'APPROVED' } } } } },
    });
    return cities.map((c) => ({ slug: c.slug, name: c.name, region: c.region, listings: c._count.listings }));
  });
};
