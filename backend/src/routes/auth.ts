/**
 * POST /api/auth/nonce   — issue a sign-in challenge for a wallet
 * POST /api/auth/verify  — verify signed challenge, set httpOnly cookie + return user
 * POST /api/auth/logout  — clear the auth cookie
 * GET  /api/auth/me      — return current user (requires auth)
 * PUT  /api/auth/me      — update display name (requires auth)
 */

import { Router, Request, Response } from "express";
import { prisma } from "../index";
import { verifyWalletSignature } from "../lib/solana";
import { signToken } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import crypto from "crypto";

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 24 * 60 * 60 * 1000, // 24 hours in ms
  path: "/",
};

// ── POST /api/auth/nonce ──────────────────────────────────────────────────────
router.post("/nonce", async (req: Request, res: Response): Promise<void> => {
  const { wallet } = req.body as { wallet?: string };
  if (!wallet || typeof wallet !== "string") {
    res.status(400).json({ error: "wallet address is required" });
    return;
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

  await prisma.nonce.upsert({
    where: { walletAddress: wallet },
    update: { value: nonce, expiresAt },
    create: { walletAddress: wallet, value: nonce, expiresAt },
  });

  const message = `Sign in to PetX\nNonce: ${nonce}`;
  res.json({ nonce, message });
});

// ── POST /api/auth/verify ─────────────────────────────────────────────────────
router.post("/verify", async (req: Request, res: Response): Promise<void> => {
  const { wallet, signature, nonce } = req.body as {
    wallet?: string;
    signature?: string;
    nonce?: string;
  };

  if (!wallet || !signature || !nonce) {
    res.status(400).json({ error: "wallet, signature, and nonce are required" });
    return;
  }

  const stored = await prisma.nonce.findUnique({ where: { walletAddress: wallet } });
  if (!stored || stored.value !== nonce || stored.expiresAt < new Date()) {
    res.status(401).json({ error: "Nonce invalid or expired — request a new one" });
    return;
  }

  const message = `Sign in to PetX\nNonce: ${nonce}`;
  if (!verifyWalletSignature(wallet, message, signature)) {
    res.status(401).json({ error: "Signature verification failed" });
    return;
  }

  await prisma.nonce.delete({ where: { walletAddress: wallet } });

  const user = await prisma.user.upsert({
    where: { walletAddress: wallet },
    update: {},
    create: { walletAddress: wallet, displayName: wallet.slice(0, 8) + "…" },
  });

  const token = signToken(wallet);

  // Set httpOnly cookie — inaccessible to JavaScript
  res.cookie("token", token, COOKIE_OPTS);

  res.json({ user: { wallet: user.walletAddress, displayName: user.displayName } });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post("/logout", (_req: Request, res: Response): void => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const user = await prisma.user.findUnique({ where: { walletAddress: wallet } });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ wallet: user.walletAddress, displayName: user.displayName, createdAt: user.createdAt });
});

// ── PUT /api/auth/me ──────────────────────────────────────────────────────────
router.put("/me", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const wallet = req.auth!.wallet;
  const { displayName } = req.body as { displayName?: string };
  if (!displayName || displayName.trim().length === 0) {
    res.status(400).json({ error: "displayName is required" });
    return;
  }
  if (displayName.trim().length > 64) {
    res.status(400).json({ error: "displayName must be 64 characters or fewer" });
    return;
  }
  const user = await prisma.user.update({
    where: { walletAddress: wallet },
    data: { displayName: displayName.trim() },
  });
  res.json({ wallet: user.walletAddress, displayName: user.displayName });
});

export default router;
