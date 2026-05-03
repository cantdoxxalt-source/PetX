/**
 * POST /api/upload/pet
 *   multipart/form-data fields:
 *     petJson     — the pet.json file
 *     spritesheet — the spritesheet.webp file
 *     tags        — (optional) array of tag strings
 *
 * Files are written to a local tmp dir by multer, uploaded to R2, then deleted locally.
 */

import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import { prisma } from "../index";
import { requireAuth } from "../middleware/auth";
import { TMP_DIR } from "../lib/storage";
import { uploadToR2 } from "../lib/r2";
import { v4 as uuidv4 } from "uuid";
import { lamportsToSol } from "../lib/solana";

const router = Router();

// ── Multer — land files in tmp, we'll push to R2 then delete ─────────────────
const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "petJson" && !file.originalname.endsWith(".json")) {
      return cb(new Error("petJson must be a .json file"));
    }
    if (
      file.fieldname === "spritesheet" &&
      !["image/webp", "image/png"].includes(file.mimetype)
    ) {
      return cb(new Error("spritesheet must be webp or png"));
    }
    cb(null, true);
  },
});

// ── Manifest validation ───────────────────────────────────────────────────────

interface PetManifest {
  id: string;
  name?: string;
  displayName?: string;
  description?: string;
  tags?: string[];
  animations?: Array<{ id: string; row: number; frames: number; fps?: number }>;
  frames?: number;
  fps?: number;
  scale?: number;
}

function validateManifest(raw: unknown): PetManifest {
  if (typeof raw !== "object" || raw === null) throw new Error("pet.json must be a JSON object");
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== "string" || !/^[a-z0-9_-]+$/.test(m.id))
    throw new Error("pet.json must have a kebab-case 'id' field");
  if (!m.displayName && !m.name)
    throw new Error("pet.json must have a 'displayName' or 'name' field");
  return m as unknown as PetManifest;
}

// ── POST /api/upload/pet ──────────────────────────────────────────────────────
router.post(
  "/pet",
  requireAuth,
  upload.fields([
    { name: "petJson", maxCount: 1 },
    { name: "spritesheet", maxCount: 1 },
  ]),
  async (req: Request, res: Response): Promise<void> => {
    const files = req.files as Record<string, Express.Multer.File[]>;
    const jsonFile  = files?.petJson?.[0];
    const sheetFile = files?.spritesheet?.[0];

    const cleanup = () => {
      [jsonFile, sheetFile].forEach((f) => {
        if (f && fs.existsSync(f.path)) fs.unlinkSync(f.path);
      });
    };

    if (!jsonFile || !sheetFile) {
      cleanup();
      res.status(400).json({ error: "Both petJson and spritesheet files are required" });
      return;
    }

    // Parse + validate manifest
    let manifest: PetManifest;
    try {
      const raw = JSON.parse(fs.readFileSync(jsonFile.path, "utf-8"));
      manifest = validateManifest(raw);
    } catch (err: any) {
      cleanup();
      res.status(400).json({ error: `pet.json validation failed: ${err.message}` });
      return;
    }

    const wallet = req.auth!.wallet;
    const petId  = uuidv4();

    // Upload both files to R2
    try {
      const [spriteBuf, jsonBuf] = await Promise.all([
        fs.promises.readFile(sheetFile.path),
        fs.promises.readFile(jsonFile.path),
      ]);

      // Validate spritesheet magic bytes — must be WebP (RIFF....WEBP) or PNG (89 50 4E 47)
      const isWebP = spriteBuf.length > 12 &&
        spriteBuf.slice(0, 4).toString("ascii") === "RIFF" &&
        spriteBuf.slice(8, 12).toString("ascii") === "WEBP";
      const isPNG = spriteBuf.length > 4 &&
        spriteBuf[0] === 0x89 && spriteBuf[1] === 0x50 &&
        spriteBuf[2] === 0x4E && spriteBuf[3] === 0x47;
      if (!isWebP && !isPNG) {
        cleanup();
        res.status(400).json({ error: "spritesheet file content is not a valid WebP or PNG image" });
        return;
      }
      await Promise.all([
        uploadToR2(`${petId}/spritesheet.webp`, spriteBuf, sheetFile.mimetype || "image/webp"),
        uploadToR2(`${petId}/pet.json`,          jsonBuf,  "application/json"),
      ]);
    } catch (err: any) {
      console.error("[upload] R2 error:", err);
      cleanup();
      res.status(500).json({ error: "File upload failed — please try again" });
      return;
    } finally {
      cleanup(); // always remove local tmp files
    }

    // Derive metadata
    const displayName = (manifest.displayName ?? manifest.name ?? manifest.id) as string;
    const description = (manifest.description ?? "") as string;
    const manifestTags: string[] = Array.isArray(manifest.tags) ? manifest.tags : [];
    const formTagsRaw  = req.body.tags;
    const formTags: string[] = Array.isArray(formTagsRaw)
      ? formTagsRaw : formTagsRaw ? [formTagsRaw] : [];
    const allowedTags = ["cute", "weird", "minimal", "animated", "pixel", "hand-drawn"];
    const tags = [...new Set([...manifestTags, ...formTags])].filter((t) => allowedTags.includes(t));

    const firstAnimation = manifest.animations?.[0];
    const frames = manifest.frames ?? firstAnimation?.frames ?? 6;
    const fps    = manifest.fps    ?? firstAnimation?.fps    ?? 12;
    const scale  = typeof manifest.scale === "number" ? manifest.scale : 1.0;

    // Ensure user exists
    await prisma.user.upsert({
      where: { walletAddress: wallet },
      update: {},
      create: { walletAddress: wallet, displayName: wallet.slice(0, 8) + "…" },
    });

    const pet = await prisma.pet.create({
      data: {
        id: petId,
        ownerWallet: wallet,
        creatorWallet: wallet,
        displayName,
        description,
        tags,
        frames,
        fps,
        scale,
        spritesheetKey: `${petId}/spritesheet.webp`,
        jsonKey: `${petId}/pet.json`,
        isListed: false,
      },
      include: {
        owner: { select: { displayName: true } },
        likes: { select: { walletAddress: true } },
      },
    });

    // Record CREATED event (fire-and-forget)
    prisma.petEvent.create({ data: { petId, type: "CREATED", walletAddress: wallet } }).catch(() => {});

    res.json({
      id: pet.id,
      ownerWallet: pet.ownerWallet,
      creatorWallet: pet.creatorWallet,
      ownerName: pet.owner?.displayName ?? wallet.slice(0, 8) + "…",
      displayName: pet.displayName,
      description: pet.description ?? "",
      tags: pet.tags,
      frames: pet.frames,
      fps: pet.fps,
      scale: pet.scale,
      spritesheetUrl: `/api/sprites/${pet.id}`,
      priceLamports: pet.priceLamports ? pet.priceLamports.toString() : null,
      priceSol: pet.priceLamports ? lamportsToSol(pet.priceLamports) : null,
      isListed: pet.isListed,
      likeCount: 0,
      viewCount: 0,
      downloadCount: 0,
      createdAt: pet.createdAt,
      likedByMe: false,
      isOwner: true,
    });
  }
);

export default router;
