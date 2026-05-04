/**
 * Vercel Serverless Function — wraps the Express backend.
 * All /api/* requests (and /health) are rewritten here by vercel.json.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Lazy-load the compiled CommonJS backend once per instance (cold start)
let _app = null;

function getApp() {
  if (!_app) {
    const backend = require("../backend/dist/index.js");
    _app = backend.default;
  }
  return _app;
}

export default async function handler(req, res) {
  try {
    const app = getApp();
    return app(req, res);
  } catch (err) {
    console.error("[serverless] handler error:", err);
    res.status(503).json({ error: "Service temporarily unavailable. Please try again." });
  }
}
