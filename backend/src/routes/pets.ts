/**
 * GET    /api/pets           — browse listed pets (public)
 * GET    /api/pets/:id       — single pet detail (public)
 * POST   /api/pets/:id/view  — increment view count
 * POST   /api/pets/:id/like  — toggle like (auth)
 * POST   /api/pets/:id/mint  — record NFT mint address (auth, owner)
 * POST   /api/pets/:id/list  — list for sale, DB only (auth, owner, no mintAddress)
 * POST   /api/pets/:id/list-escrow — list for sale, NFT in escrow (auth, owner, mintAddress)
 * POST   /api/pets/:id/unlist — remove listing (auth, owner)
 * POST   /api/pets/:id/buy-prepare — build atomic partial tx (auth, buyer)
 * POST   /api/pets/:id/buy-confirm — confirm atomic purchase (auth, buyer)
 * POST   /api/pets/:id/buy   — legacy SOL-only purchase (auth, non-minted pets)
 * GET    /api/pets/:id/download — download ZIP (auth, owner)
 * DELETE /api/pets/:id       — delete pet (auth, owner)
 */

import { Router, Request, Response } from "express";
import { prisma } from "../index";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { verifySolTransfer, lamportsToSol } from "../lib/solana";
import { streamPetZip } from "../lib/storage";
import { deletePetFromR2 } from "../lib/r2";
import {
  ESCROW_PUBLIC_KEY,
  fetchOnChainOwner,
  waitForOwner,
  isOnChainOwner,
  buildAtomicBuyTx,
  escrowTransferNft,
} from "../lib/metaplex";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPet(pet: any, viewerWallet?: string) {
  return {
    id: pet.id,
    ownerWallet: pet.ownerWallet,
    creatorWallet: pet.creatorWallet,
    ownerName: pet.owner?.displayName ?? pet.ownerWallet.slice(0, 8) + "…",
    displayName: pet.displayName,
    description: pet.description ?? "",
    tags: pet.tags,
    frames: pet.frames,
    fps: pet.fps,
    scale: pet.scale,
    spritesheetUrl: `/api/sprites/${pet.id}`,
    mintAddress: pet.mintAddress ?? null,
    priceLamports: pet.priceLamports ? pet.priceLamports.toString() : null,
    priceSol: pet.priceLamports ? lamportsToSol(pet.priceLamports) : null,
    isListed: pet.isListed,
    likeCount: pet.likeCount,
    viewCount: pet.viewCount,
    downloadCount: pet.downloadCount,
    createdAt: pet.createdAt,
    likedByMe: viewerWallet
      ? pet.likes?.some((l: any) => l.walletAddress === viewerWallet)
      : false,
    isOwner: viewerWallet === pet.ownerWallet,
  };
}

const PET_INCLUDE = {
  owner: { select: { displayName: true } },
  likes: { select: { walletAddress: true } },
};

// ── GET /api/pets ─────────────────────────────────────────────────────────────
router.get("/", optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const { q, tag, sort = "new", limit = "24", offset = "0" } = req.query as Record<string, string>;

  const where: any = {};
  if (tag) where.tags = { has: tag };
  if (sort === "listed") where.isListed = true;
  if (q) {
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const orderBy =
    sort === "popular"
      ? { likeCount: "desc" as const }
      : sort === "listed"
      ? { createdAt: "desc" as const }
      : { createdAt: "desc" as const };

  const pets = await prisma.pet.findMany({
    where,
    orderBy,
    take: Math.min(parseInt(limit) || 24, 100),
    skip: parseInt(offset) || 0,
    include: PET_INCLUDE,
  });

  res.json(pets.map((p) => formatPet(p, req.auth?.wallet)));
});

// ── GET /api/pets/:id ─────────────────────────────────────────────────────────
router.get("/:id", optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const pet = await prisma.pet.findUnique({
    where: { id: req.params.id },
    include: PET_INCLUDE,
  });
  if (!pet) {
    res.status(404).json({ error: "Pet not found" });
    return;
  }
  prisma.pet.update({ where: { id: pet.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
  res.json(formatPet(pet, req.auth?.wallet));
});

// ── POST /api/pets/:id/view ───────────────────────────────────────────────────
router.post("/:id/view", async (req: Request, res: Response): Promise<void> => {
  await prisma.pet.update({ where: { id: req.params.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
  res.json({ ok: true });
});

// ── POST /api/pets/:id/like ───────────────────────────────────────────────────
router.post("/:id/like", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;

  const existing = await prisma.like.findUnique({
    where: { walletAddress_petId: { walletAddress: wallet, petId: id } },
  });

  if (existing) {
    await prisma.$transaction([
      prisma.like.delete({ where: { walletAddress_petId: { walletAddress: wallet, petId: id } } }),
      prisma.pet.update({ where: { id }, data: { likeCount: { decrement: 1 } } }),
    ]);
    res.json({ liked: false });
  } else {
    await prisma.$transaction([
      prisma.like.create({ data: { walletAddress: wallet, petId: id } }),
      prisma.pet.update({ where: { id }, data: { likeCount: { increment: 1 } } }),
    ]);
    res.json({ liked: true });
  }
});

// ── POST /api/pets/:id/mint ───────────────────────────────────────────────────
// Records the on-chain mint address after the user mints via Phantom on the frontend.
router.post("/:id/mint", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;
  const { mintAddress } = req.body as { mintAddress?: string };

  if (!mintAddress || typeof mintAddress !== "string") {
    res.status(400).json({ error: "mintAddress is required" });
    return;
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (pet.ownerWallet !== wallet) { res.status(403).json({ error: "Not your pet" }); return; }
  if (pet.mintAddress) { res.status(409).json({ error: "Pet already minted", mintAddress: pet.mintAddress }); return; }

  // Verify on-chain: the owner actually holds this NFT
  console.log(`[mint] verifying on-chain owner for mintAddress=${mintAddress}`);
  const onChainOwner = await fetchOnChainOwner(mintAddress);
  console.log(`[mint] fetchOnChainOwner returned: ${onChainOwner}`);
  if (!onChainOwner) {
    res.status(422).json({ error: "Could not find NFT on-chain. Make sure the transaction is confirmed." });
    return;
  }
  if (onChainOwner !== wallet) {
    res.status(422).json({ error: `NFT owner on-chain (${onChainOwner}) does not match your wallet (${wallet})` });
    return;
  }

  const updated = await prisma.pet.update({
    where: { id },
    data: { mintAddress },
    include: PET_INCLUDE,
  });

  // Record MINTED event
  prisma.petEvent.create({
    data: { petId: id, type: "MINTED", walletAddress: wallet, mintAddress },
  }).catch(() => {});

  res.json(formatPet(updated, wallet));
});

// ── POST /api/pets/:id/list ───────────────────────────────────────────────────
// DB-only listing — for pets that have NOT been minted as NFTs.
// Minted pets must use /list-escrow instead.
router.post("/:id/list", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;
  const { priceSol } = req.body as { priceSol?: number };

  if (!priceSol || priceSol <= 0) {
    res.status(400).json({ error: "priceSol must be a positive number" });
    return;
  }
  if (priceSol > 1_000_000) {
    res.status(400).json({ error: "priceSol cannot exceed 1,000,000 SOL" });
    return;
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (pet.ownerWallet !== wallet) { res.status(403).json({ error: "Not your pet" }); return; }
  if (pet.mintAddress) {
    res.status(400).json({
      error: "This pet is minted as an NFT — use /list-escrow to transfer it to the escrow wallet before listing.",
    });
    return;
  }

  const priceLamports = BigInt(Math.round(priceSol * 1_000_000_000));
  const updated = await prisma.pet.update({
    where: { id },
    data: { priceLamports, isListed: true },
    include: PET_INCLUDE,
  });

  // Record LISTED event
  prisma.petEvent.create({
    data: { petId: id, type: "LISTED", walletAddress: wallet, priceLamports },
  }).catch(() => {});

  res.json(formatPet(updated, wallet));
});

// ── POST /api/pets/:id/list-escrow ────────────────────────────────────────────
// NFT listing: the caller has already transferred the NFT to the escrow wallet
// via Phantom on the frontend. This endpoint verifies on-chain and records the listing.
router.post("/:id/list-escrow", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;
  const { priceSol } = req.body as { priceSol?: number };

  if (!priceSol || priceSol <= 0) {
    res.status(400).json({ error: "priceSol must be a positive number" });
    return;
  }
  if (priceSol > 1_000_000) {
    res.status(400).json({ error: "priceSol cannot exceed 1,000,000 SOL" });
    return;
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (pet.ownerWallet !== wallet) { res.status(403).json({ error: "Not your pet" }); return; }
  if (!pet.mintAddress) {
    res.status(400).json({ error: "Pet has no mintAddress — mint it first before listing" });
    return;
  }

  // Wait until the escrow holds the NFT on-chain (retries handle RPC propagation lag)
  console.log(`[list-escrow] waiting for escrow ownership of ${pet.mintAddress}`);
  const confirmedOwner = await waitForOwner(pet.mintAddress, ESCROW_PUBLIC_KEY);
  if (!confirmedOwner) {
    const current = await fetchOnChainOwner(pet.mintAddress);
    res.status(422).json({
      error: `NFT did not arrive in escrow after waiting. Current owner: ${current ?? "unknown"}. Please try listing again.`,
    });
    return;
  }
  console.log(`[list-escrow] escrow confirmed as owner of ${pet.mintAddress}`);

  const priceLamports = BigInt(Math.round(priceSol * 1_000_000_000));
  const updated = await prisma.pet.update({
    where: { id },
    data: { priceLamports, isListed: true },
    include: PET_INCLUDE,
  });

  // Record LISTED event
  prisma.petEvent.create({
    data: { petId: id, type: "LISTED", walletAddress: wallet, priceLamports },
  }).catch(() => {});

  res.json(formatPet(updated, wallet));
});

// ── POST /api/pets/:id/unlist ─────────────────────────────────────────────────
router.post("/:id/unlist", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (pet.ownerWallet !== wallet) { res.status(403).json({ error: "Not your pet" }); return; }

  // If the pet is an NFT currently in escrow, return it to the owner
  if (pet.mintAddress && pet.isListed) {
    const onChainOwner = await fetchOnChainOwner(pet.mintAddress);
    if (onChainOwner === ESCROW_PUBLIC_KEY) {
      try {
        await escrowTransferNft(pet.mintAddress, wallet);
      } catch (err: any) {
        console.error("[unlist] escrow return error:", err);
        res.status(500).json({ error: "Failed to return NFT from escrow — please try again" });
        return;
      }
    }
    // If the on-chain owner is already the seller (e.g. listing was DB-only),
    // skip the on-chain transfer.
  }

  const updated = await prisma.pet.update({
    where: { id },
    data: { isListed: false, priceLamports: null },
    include: PET_INCLUDE,
  });

  // Record UNLISTED event
  prisma.petEvent.create({
    data: { petId: id, type: "UNLISTED", walletAddress: wallet },
  }).catch(() => {});

  res.json(formatPet(updated, wallet));
});

// ── POST /api/pets/:id/buy-prepare ────────────────────────────────────────────
// Builds an atomic buy transaction for NFT pets.
// Escrow partially signs the NFT transfer; buyer must complete signing and broadcast.
router.post("/:id/buy-prepare", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const buyerWallet = req.auth!.wallet;
  const { id } = req.params;

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (!pet.isListed || !pet.priceLamports) {
    res.status(400).json({ error: "Pet is not listed for sale" });
    return;
  }
  if (!pet.mintAddress) {
    res.status(400).json({ error: "Pet has no NFT mint address — use /buy for non-minted pets" });
    return;
  }
  if (pet.ownerWallet === buyerWallet) {
    res.status(400).json({ error: "You already own this pet" });
    return;
  }

  // Verify escrow currently holds the NFT on-chain
  const onChainOwner = await fetchOnChainOwner(pet.mintAddress);
  if (onChainOwner !== ESCROW_PUBLIC_KEY) {
    res.status(400).json({ error: "NFT is not in escrow — listing may be invalid" });
    return;
  }

  try {
    const result = await buildAtomicBuyTx(
      pet.mintAddress,
      buyerWallet,
      pet.ownerWallet, // seller
      pet.priceLamports
    );

    res.json({
      tx: result.tx,
      blockhash: result.blockhash,
      priceLamports: pet.priceLamports.toString(),
      sellerWallet: pet.ownerWallet,
      escrowPublicKey: ESCROW_PUBLIC_KEY,
    });
  } catch (err: any) {
    console.error("[buy-prepare] error:", err);
    res.status(500).json({ error: "Failed to build transaction — please try again" });
  }
});

// ── POST /api/pets/:id/buy-confirm ────────────────────────────────────────────
// After the buyer broadcasts the atomic transaction, call this to verify
// on-chain and update ownership in the DB.
router.post("/:id/buy-confirm", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const buyerWallet = req.auth!.wallet;
  const { id } = req.params;
  const { txSignature } = req.body as { txSignature?: string };

  if (!txSignature) {
    res.status(400).json({ error: "txSignature is required" });
    return;
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (!pet.isListed || !pet.priceLamports || !pet.mintAddress) {
    res.status(400).json({ error: "Pet not available for purchase" });
    return;
  }
  if (pet.ownerWallet === buyerWallet) {
    res.status(400).json({ error: "You already own this pet" });
    return;
  }

  // Replay protection
  const existing = await prisma.transaction.findUnique({ where: { txSignature } });
  if (existing) {
    res.status(409).json({ error: "Transaction already processed" });
    return;
  }

  // Verify 1: SOL transfer happened (buyer → seller, correct amount)
  const solVerify = await verifySolTransfer(
    txSignature,
    buyerWallet,
    pet.ownerWallet,
    pet.priceLamports
  );
  if (!solVerify.ok) {
    res.status(422).json({ error: `SOL transfer verification failed: ${solVerify.error}` });
    return;
  }

  // Verify 2: wait until NFT is owned by buyer on-chain (handles RPC propagation lag)
  const confirmedBuyer = await waitForOwner(pet.mintAddress, buyerWallet);
  if (!confirmedBuyer) {
    const nftOwner = await fetchOnChainOwner(pet.mintAddress);
    res.status(422).json({
      error: `NFT ownership not transferred on-chain yet. Current owner: ${nftOwner ?? "unknown"}`,
    });
    return;
  }

  // Ensure buyer exists in users table
  await prisma.user.upsert({
    where: { walletAddress: buyerWallet },
    update: {},
    create: { walletAddress: buyerWallet, displayName: buyerWallet.slice(0, 8) + "…" },
  });

  // Atomic DB update
  const [, updatedPet] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        petId: id,
        sellerWallet: pet.ownerWallet,
        buyerWallet,
        priceLamports: pet.priceLamports,
        txSignature,
      },
    }),
    prisma.pet.update({
      where: { id },
      data: {
        ownerWallet: buyerWallet,
        isListed: false,
        priceLamports: null,
        downloadCount: { increment: 1 },
      },
      include: PET_INCLUDE,
    }),
    prisma.petEvent.create({
      data: {
        petId: id,
        type: "SOLD",
        walletAddress: buyerWallet,
        counterparty: pet.ownerWallet,
        priceLamports: pet.priceLamports,
        txSignature,
      },
    }),
  ]);

  res.json({
    success: true,
    pet: formatPet(updatedPet, buyerWallet),
    message: "Purchase confirmed — NFT and file access transferred!",
  });
});

// ── POST /api/pets/:id/buy ────────────────────────────────────────────────────
// Legacy buy endpoint for non-minted pets (plain SOL transfer, DB ownership only).
// For minted pets, use /buy-prepare → broadcast → /buy-confirm.
router.post("/:id/buy", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const buyerWallet = req.auth!.wallet;
  const { id } = req.params;
  const { txSignature } = req.body as { txSignature?: string };

  if (!txSignature) {
    res.status(400).json({ error: "txSignature is required" });
    return;
  }

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (!pet.isListed || !pet.priceLamports) { res.status(400).json({ error: "Pet is not listed for sale" }); return; }
  if (pet.ownerWallet === buyerWallet) { res.status(400).json({ error: "You already own this pet" }); return; }

  // Minted pets must use the atomic flow
  if (pet.mintAddress) {
    res.status(400).json({
      error: "This is an NFT pet — use /buy-prepare and /buy-confirm for atomic purchase.",
    });
    return;
  }

  // Replay protection
  const existing = await prisma.transaction.findUnique({ where: { txSignature } });
  if (existing) {
    res.status(409).json({ error: "Transaction already processed" });
    return;
  }

  // Verify on-chain SOL transfer
  const verify = await verifySolTransfer(txSignature, buyerWallet, pet.ownerWallet, pet.priceLamports);
  if (!verify.ok) {
    res.status(422).json({ error: `On-chain verification failed: ${verify.error}` });
    return;
  }

  await prisma.user.upsert({
    where: { walletAddress: buyerWallet },
    update: {},
    create: { walletAddress: buyerWallet, displayName: buyerWallet.slice(0, 8) + "…" },
  });

  const [, updatedPet] = await prisma.$transaction([
    prisma.transaction.create({
      data: {
        petId: id,
        sellerWallet: pet.ownerWallet,
        buyerWallet,
        priceLamports: pet.priceLamports,
        txSignature,
      },
    }),
    prisma.pet.update({
      where: { id },
      data: {
        ownerWallet: buyerWallet,
        isListed: false,
        priceLamports: null,
        downloadCount: { increment: 1 },
      },
      include: PET_INCLUDE,
    }),
    prisma.petEvent.create({
      data: {
        petId: id,
        type: "SOLD",
        walletAddress: buyerWallet,
        counterparty: pet.ownerWallet,
        priceLamports: pet.priceLamports,
        txSignature,
      },
    }),
  ]);

  res.json({
    success: true,
    pet: formatPet(updatedPet, buyerWallet),
    message: "Purchase successful — you now own this pet!",
  });
});

// ── GET /api/pets/:id/history ─────────────────────────────────────────────────
router.get("/:id/history", async (req: Request, res: Response): Promise<void> => {
  const pet = await prisma.pet.findUnique({ where: { id: req.params.id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }

  const events = await prisma.petEvent.findMany({
    where: { petId: req.params.id },
    orderBy: { createdAt: "asc" },
  });

  res.json(
    events.map((e) => ({
      id: e.id,
      type: e.type,
      walletAddress: e.walletAddress,
      counterparty: e.counterparty ?? null,
      priceLamports: e.priceLamports ? e.priceLamports.toString() : null,
      txSignature: e.txSignature ?? null,
      mintAddress: e.mintAddress ?? null,
      createdAt: e.createdAt,
    }))
  );
});

// ── GET /api/pets/:id/download ────────────────────────────────────────────────
router.get("/:id/download", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }

  // For minted NFTs: verify ownership on-chain
  if (pet.mintAddress) {
    const ownsNft = await isOnChainOwner(pet.mintAddress, wallet);
    if (!ownsNft) {
      res.status(403).json({
        error: "You must own this NFT on-chain to download its files.",
      });
      return;
    }
  } else {
    // Non-minted: check DB ownership
    if (pet.ownerWallet !== wallet) {
      res.status(403).json({ error: "You must own this pet to download its files" });
      return;
    }
  }

  try {
    await streamPetZip(id, pet.displayName, res);
    prisma.pet.update({ where: { id }, data: { downloadCount: { increment: 1 } } }).catch(() => {});
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Download failed" });
  }
});

// ── DELETE /api/pets/:id ──────────────────────────────────────────────────────
router.delete("/:id", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { id } = req.params;

  const pet = await prisma.pet.findUnique({ where: { id } });
  if (!pet) { res.status(404).json({ error: "Pet not found" }); return; }
  if (pet.ownerWallet !== wallet) { res.status(403).json({ error: "Not your pet" }); return; }

  await prisma.pet.delete({ where: { id } });
  deletePetFromR2(id).catch(() => {}); // fire-and-forget
  res.json({ ok: true });
});

export default router;
