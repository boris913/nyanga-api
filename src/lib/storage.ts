import crypto from 'node:crypto';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { Env } from '../env.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const ALLOWED_IMAGE_TYPES = Object.keys(EXT);

export function createStorage(env: Env) {
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    credentials: env.S3_ACCESS_KEY_ID
      ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
      : undefined,
  });

  return {
    // Formulaire d'envoi direct navigateur → bucket, taille et type imposés par la signature.
    async presignUpload(prefix: 'listings' | 'selfies', ownerId: string, contentType: string) {
      const key = `${prefix}/${ownerId}/${crypto.randomUUID()}.${EXT[contentType]}`;
      const post = await createPresignedPost(client, {
        Bucket: env.S3_BUCKET,
        Key: key,
        Conditions: [
          ['content-length-range', 1, MAX_PHOTO_BYTES],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: 300,
      });
      return { key, url: post.url, fields: post.fields };
    },
    publicUrl: (key: string) => `${env.MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${key}`,
    // Fichiers privés (selfies) : lien temporaire, seul listings/* est servi publiquement par CloudFront.
    signedUrl: (key: string) => getSignedUrl(client, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: 600 }),
  };
}

export type Storage = ReturnType<typeof createStorage>;
