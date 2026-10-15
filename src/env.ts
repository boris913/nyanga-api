import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  MAIL_DRIVER: z.enum(['none', 'console']).default('none'),
  MAIL_FROM: z.string().default('Nyanga <no-reply@nyanga.cm>'),
  GOOGLE_CLIENT_ID: z.string().default(''),
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default('eu-west-3'),
  S3_ENDPOINT: z.string().optional().transform((v) => v || undefined),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  MEDIA_PUBLIC_URL: z.string().default(''),
  CHARIOW_API_KEY: z.string().default(''),
  CHARIOW_PULSE_SECRET: z.string().default(''),
  CHARIOW_PRODUCT_PREMIUM: z.string().default(''),
  CHARIOW_PRODUCT_VIP: z.string().default(''),
  CHARIOW_PRODUCT_BUMP: z.string().default(''),
  CHARIOW_PRODUCT_FEATURED_24H: z.string().default(''),
  CHARIOW_PRODUCT_FEATURED_7D: z.string().default(''),
  // En production, CloudFront ajoute cet en-tête : toute requête sans lui est refusée.
  ORIGIN_SECRET: z.string().default(''),
  ADMIN_EMAILS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Variables d'environnement invalides : ${fields}`);
  }
  return parsed.data;
}
