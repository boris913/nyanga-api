// Nomme un administrateur directement en base : npm run admin:promote -- email@exemple.cm
// À lancer par quelqu'un qui a accès à la base, après que la personne a créé son compte.
import { PrismaClient } from '@prisma/client';

const email = process.argv[2]?.trim().toLowerCase();
if (!email) {
  console.error('Usage : npm run admin:promote -- email@exemple.cm');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const user = await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } }).catch(() => null);
  if (!user) {
    console.error(`Aucun compte pour ${email} : la personne doit d'abord s'inscrire.`);
    process.exitCode = 1;
  } else console.log(`${email} est maintenant administrateur.`);
} finally {
  await prisma.$disconnect();
}
