import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthPayload {
  wallet: string;
  iat: number;
  exp: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is not set. Refusing to start.");
  process.exit(1);
}

/** Sign a JWT for a wallet address (24-hour expiry) */
export function signToken(wallet: string): string {
  return jwt.sign({ wallet }, JWT_SECRET!, { expiresIn: "24h" });
}

/** Verify and decode a JWT; throws on invalid/expired */
export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET!) as AuthPayload;
}

/** Extract token from cookie first, then Authorization header */
function extractToken(req: Request): string | null {
  if (req.cookies?.token) return req.cookies.token as string;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  return null;
}

/** Express middleware — requires valid token (cookie or Bearer) */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    req.auth = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Middleware — attaches auth if present but doesn't require it */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (token) {
    try {
      req.auth = verifyToken(token);
    } catch {
      // ignore — optional
    }
  }
  next();
}
