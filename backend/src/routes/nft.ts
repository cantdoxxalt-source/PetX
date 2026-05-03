/**
 * POST /api/nft/pin/:petId      — Pin spritesheet + metadata to IPFS via Pinata (auth, owner)
 * GET  /api/nft/metadata/:petId — Metaplex-standard NFT metadata JSON (public, fallback)
 * GET  /api/nft/config          — Returns escrow public key and network info
 */

import { Router, Request, Response } from "express";
import { prisma } from "../index";
import { ESCROW_PUBLIC_KEY } from "../lib/metaplex";
import { requireAuth } from "../middleware/auth";
import { getR2Buffer } from "../lib/r2";
import { pinBufferToPinata, pinJsonToPinata, ipfsToGateway } from "../lib/pinata";

const router = Router();

// ── POST /api/nft/pin/:petId ──────────────────────────────────────────────────
// Pins the pet's spritesheet and metadata JSON to IPFS via Pinata.
// Returns { metadataUri: "ipfs://...", imageUri: "https://gateway.pinata.cloud/..." }
// Must be called before minting — the returned metadataUri is stored on-chain.
router.post("/pin/:petId", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;

  const pet = await prisma.pet.findUnique({
    where: { id: req.params.petId },
    include: { owner: { select: { displayName: true } } },
  });

  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (pet.ownerWallet !== wallet) { res.status(403).json({ error: "Not your pet" }); return; }
  if (pet.mintAddress) {
    res.status(409).json({ error: "Pet is already minted — IPFS assets already exist on-chain" });
    return;
  }

  try {
    console.log(`[pinata] Pinning spritesheet for pet ${pet.id}…`);
    const spriteBuf = await getR2Buffer(`${pet.id}/spritesheet.webp`);
    const imageIpfsUri = await pinBufferToPinata(
      spriteBuf,
      `${pet.displayName.replace(/\s+/g, "_")}_spritesheet.webp`,
      "image/webp"
    );
    // Use HTTPS gateway URL for the "image" field — required by most wallets / explorers
    const imageHttpsUrl = ipfsToGateway(imageIpfsUri);
    console.log(`[pinata] Image pinned: ${imageIpfsUri}`);

    const baseUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";

    const metadata = {
      name: pet.displayName,
      symbol: "CPET",
      description:
        pet.description ||
        `A Codex companion pet: ${pet.displayName}. Trade and collect on Solana.`,
      image: imageHttpsUrl,
      external_url: `${baseUrl}/#/pets/${pet.id}`,
      attributes: [
        { trait_type: "Creator", value: pet.creatorWallet },
        { trait_type: "Frames",  value: pet.frames },
        { trait_type: "FPS",     value: pet.fps },
        { trait_type: "Scale",   value: pet.scale },
        ...(pet.tags ?? []).map((tag: string) => ({ trait_type: "Tag", value: tag })),
      ],
      properties: {
        files: [{ uri: imageHttpsUrl, type: "image/webp" }],
        category: "image",
        creators: [{ address: pet.creatorWallet, share: 100 }],
      },
    };

    console.log(`[pinata] Pinning metadata JSON for pet ${pet.id}…`);
    const metadataIpfsUri = await pinJsonToPinata(metadata, `${pet.displayName} Metadata`);
    console.log(`[pinata] Metadata pinned: ${metadataIpfsUri}`);

    res.json({
      metadataUri: metadataIpfsUri,   // ipfs://... — use this as the NFT uri on-chain
      imageUri: imageHttpsUrl,         // https://... — for display
    });
  } catch (err: any) {
    console.error("[pinata] upload error:", err);
    res.status(500).json({ error: "IPFS upload failed — please try again" });
  }
});

// ── GET /api/nft/metadata/:petId ──────────────────────────────────────────────
router.get("/metadata/:petId", async (req: Request, res: Response): Promise<void> => {
  const pet = await prisma.pet.findUnique({
    where: { id: req.params.petId },
    include: { owner: { select: { displayName: true } } },
  });

  if (!pet) {
    res.status(404).json({ error: "Pet not found" });
    return;
  }

  const baseUrl =
    process.env.FRONTEND_URL ??
    (process.env.RAILWAY_ENVIRONMENT
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:4000");

  res.setHeader("Cache-Control", "public, max-age=3600");
  res.json({
    name: pet.displayName,
    symbol: "CPET",
    description:
      pet.description ||
      `A Codex companion pet: ${pet.displayName}. Trade and collect on Solana.`,
    image: `${baseUrl}/api/sprites/${pet.id}`,
    external_url: `${baseUrl}/#/pets/${pet.id}`,
    attributes: [
      { trait_type: "Creator", value: pet.creatorWallet },
      { trait_type: "Frames", value: pet.frames },
      { trait_type: "FPS", value: pet.fps },
      { trait_type: "Scale", value: pet.scale },
      ...(pet.tags ?? []).map((tag) => ({ trait_type: "Tag", value: tag })),
    ],
    properties: {
      files: [
        {
          uri: `${baseUrl}/api/sprites/${pet.id}`,
          type: "image/webp",
        },
      ],
      category: "image",
      creators: [{ address: pet.creatorWallet, share: 100 }],
    },
  });
});

// ── GET /api/nft/config ───────────────────────────────────────────────────────
router.get("/config", (_req: Request, res: Response) => {
  res.json({
    escrowPublicKey: ESCROW_PUBLIC_KEY,
    network: process.env.SOLANA_RPC_URL?.includes("mainnet") ? "mainnet-beta" : "devnet",
    // rpcUrl intentionally omitted — it contains a private API key
  });
});

export default router;
