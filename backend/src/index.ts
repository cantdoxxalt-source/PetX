import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { initStorage } from "./lib/storage";
import { getR2Stream, R2_PUBLIC_URL } from "./lib/r2";

// Routes
import authRouter   from "./routes/auth";
import petsRouter   from "./routes/pets";
import uploadRouter from "./routes/upload";
import usersRouter  from "./routes/users";
import nftRouter    from "./routes/nft";

// ── Prisma singleton ──────────────────────────────────────────────────────────
export const prisma = new PrismaClient();

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();
const PORT = parseInt(process.env.PORT ?? "4000", 10);
const FRONTEND_DIST = path.join(__dirname, "..", "..", "dist");

initStorage();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],   // Vite dev; tighten in prod
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://api.fontshare.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://api.fontshare.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        connectSrc: ["'self'", "https:", "wss:"],   // allows Solana RPC, Pinata, R2
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cookieParser());

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
];
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);

// ── Rate limiting ─────────────────────────────────────────────────────────────

// Global limiter — 300 req / 15 min per IP
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests — please slow down." },
  })
);

// Strict limiter for expensive ops — 20 req / 15 min per IP
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit reached for this action." },
});
// applied individually on upload, auth, nft pin below

app.use(express.json({ limit: "2mb" }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected", ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, db: "unreachable" });
  }
});

// ── Sprite serving — proxy from R2 ───────────────────────────────────────────
// If R2_PUBLIC_URL is set, redirect directly (CDN serves the file).
// Otherwise stream through the backend.
app.get("/api/sprites/:petId", async (req, res) => {
  const petId = req.params.petId;

  if (R2_PUBLIC_URL) {
    return res.redirect(302, `${R2_PUBLIC_URL}/${petId}/spritesheet.webp`);
  }

  try {
    const stream = await getR2Stream(`${petId}/spritesheet.webp`);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=86400");
    stream.pipe(res);
    stream.on("error", () => res.status(500).end());
  } catch {
    res.status(404).json({ error: "Sprite not found" });
  }
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use("/api/auth",   strictLimiter, authRouter);
app.use("/api/upload", strictLimiter, uploadRouter);
app.use("/api/nft",    strictLimiter, nftRouter);
app.use("/api/pets",   petsRouter);
app.use("/api/users",  usersRouter);

// ── Frontend static (production) ─────────────────────────────────────────────
if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
}

// ── Start + graceful shutdown ─────────────────────────────────────────────────
async function main() {
  await prisma.$connect();
  console.log("✓ Prisma connected to PostgreSQL");

  const server = app.listen(PORT, () => {
    console.log(`✓ Server running on port ${PORT}`);
    console.log(`  R2 bucket:  ${process.env.R2_BUCKET ?? "(not configured)"}`);
    console.log(`  Public URL: ${R2_PUBLIC_URL || "(proxying through backend)"}`);
    console.log(`  Frontend:   ${fs.existsSync(FRONTEND_DIST) ? FRONTEND_DIST : "(not built)"}`);
  });

  async function shutdown(signal: string) {
    console.log(`\n[${signal}] Shutting down…`);
    server.close(async () => {
      await prisma.$disconnect();
      console.log("✓ DB disconnected. Bye.");
      process.exit(0);
    });
    // Force exit if shutdown hangs
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

export default app;
