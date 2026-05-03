/**
 * Storage helpers.
 * - Multer tmp dir lives locally (just for the upload request lifetime).
 * - Permanent files (spritesheet.webp, pet.json) live in R2.
 * - ZIP streaming pulls both files from R2 on demand.
 */

import fs from "fs";
import path from "path";
import archiver from "archiver";
import { getR2Stream, getR2Buffer } from "./r2";

// ── Tmp dir for multer ────────────────────────────────────────────────────────

export const TMP_DIR = path.resolve(process.env.TMP_DIR ?? path.join(process.cwd(), "_tmp"));

export function initStorage() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

// ── R2 key helpers ────────────────────────────────────────────────────────────

export function spritesheetKey(petId: string) { return `${petId}/spritesheet.webp`; }
export function jsonKey(petId: string)        { return `${petId}/pet.json`; }

// ── Local tmp path (used only during an upload request) ──────────────────────

export function tmpPath(filename: string) {
  return path.join(TMP_DIR, filename);
}

// ── ZIP download from R2 ──────────────────────────────────────────────────────

/**
 * Stream a ZIP archive (spritesheet + pet.json) from R2 directly to the response.
 */
export async function streamPetZip(
  petId: string,
  petDisplayName: string,
  res: import("express").Response
): Promise<void> {
  const [spriteStream, jsonStream] = await Promise.all([
    getR2Stream(spritesheetKey(petId)),
    getR2Stream(jsonKey(petId)),
  ]);

  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${petId}.codex-pet.zip"`
  );

  const archive = archiver("zip", { zlib: { level: 6 } });

  return new Promise((resolve, reject) => {
    archive.on("error", reject);
    archive.pipe(res);
    archive.append(spriteStream, { name: "spritesheet.webp" });
    archive.append(jsonStream,   { name: "pet.json" });
    archive.finalize().then(resolve).catch(reject);
  });
}
