/**
 * Cloudflare R2 storage driver (S3-compatible).
 * All pet files (spritesheet.webp, pet.json) live in R2.
 * Key layout: {petId}/spritesheet.webp  and  {petId}/pet.json
 */

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { Readable } from "stream";

const ENDPOINT   = process.env.R2_ENDPOINT!;        // https://....r2.cloudflarestorage.com
const BUCKET     = process.env.R2_BUCKET!;           // petxspace
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID!;
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY!;

/** Public CDN base URL (optional — enables direct browser access to spritesheets) */
export const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

export const r2 = new S3Client({
  region: "auto",
  endpoint: ENDPOINT,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  await r2.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType })
  );
}

// ── Download ──────────────────────────────────────────────────────────────────

/** Returns a Node.js Readable stream for the given key. */
export async function getR2Stream(key: string): Promise<Readable> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!res.Body) throw new Error(`R2: empty body for key ${key}`);
  return res.Body as Readable;
}

/** Downloads the full file into a Buffer (for small files like pet.json / spritesheet). */
export async function getR2Buffer(key: string): Promise<Buffer> {
  const stream = await getR2Stream(key);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteFromR2(key: string): Promise<void> {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })).catch(() => {});
}

/** Delete all files for a pet (spritesheet + json). */
export async function deletePetFromR2(petId: string): Promise<void> {
  await Promise.all([
    deleteFromR2(`${petId}/spritesheet.webp`),
    deleteFromR2(`${petId}/pet.json`),
  ]);
}

// ── URL ───────────────────────────────────────────────────────────────────────

/**
 * Public URL for a spritesheet.
 * If R2_PUBLIC_URL is configured, returns a direct CDN URL.
 * Otherwise returns null (caller should proxy through /api/sprites/:petId).
 */
export function publicSpriteUrl(petId: string): string | null {
  if (!R2_PUBLIC_URL) return null;
  return `${R2_PUBLIC_URL}/${petId}/spritesheet.webp`;
}
