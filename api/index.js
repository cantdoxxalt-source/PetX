/**
 * Vercel Serverless Function — wraps the Express backend.
 * All /api/* requests (and /health) are rewritten here by vercel.json.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Lazy-load the compiled CommonJS backend on first request (cold start)
let _app;
let _prisma;
let _connectPromise = null;

function ensureReady() {
  if (!_connectPromise) {
    const backend = require("../backend/dist/index.js");
    _app = backend.default;
    _prisma = backend.prisma;
    _connectPromise = _prisma.$connect().catch((err) => {
      // Reset so the next request retries
      _connectPromise = null;
      throw err;
    });
  }
  return _connectPromise;
}

export default async function handler(req, res) {
  await ensureReady();
  return _app(req, res);
}
