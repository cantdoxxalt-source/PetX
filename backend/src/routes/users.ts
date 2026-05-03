/**
 * GET /api/users/:wallet         — public profile + their pets
 * GET /api/users/:wallet/pets    — just the pets list
 */

import { Router, Request, Response } from "express";
import { prisma } from "../index";
import { optionalAuth } from "../middleware/auth";
import { lamportsToSol } from "../lib/solana";

const router = Router();

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

// ── GET /api/users/:wallet ────────────────────────────────────────────────────
router.get("/:wallet", optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const { wallet } = req.params;

  const user = await prisma.user.findUnique({
    where: { walletAddress: wallet },
    include: {
      ownedPets: {
        orderBy: { createdAt: "desc" },
        include: {
          owner: { select: { displayName: true } },
          likes: { select: { walletAddress: true } },
        },
      },
    },
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({
    wallet: user.walletAddress,
    displayName: user.displayName,
    createdAt: user.createdAt,
    petCount: user.ownedPets.length,
    pets: user.ownedPets.map((p) => formatPet(p, req.auth?.wallet)),
  });
});

// ── GET /api/users/:wallet/pets ───────────────────────────────────────────────
router.get("/:wallet/pets", optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const pets = await prisma.pet.findMany({
    where: { ownerWallet: req.params.wallet },
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { displayName: true } },
      likes: { select: { walletAddress: true } },
    },
  });
  res.json(pets.map((p) => formatPet(p, req.auth?.wallet)));
});

export default router;
