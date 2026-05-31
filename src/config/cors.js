/**
 * Comma-separated browser origins (scheme + host + port, no trailing slash).
 * Example:
 *   CORS_ORIGINS=http://localhost:3000,http://localhost:3001,https://xhub4u.com,https://admin.xhub4u.com
 */
const parseOriginsFromEnv = () => {
  const raw = process.env.CORS_ORIGINS || "";
  if (!raw.trim()) {
    return [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
    ];
  }

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((origin) => origin.trim().replace(/\/+$/, ""))
        .filter(Boolean)
    )
  );
};

const isOriginAllowed = (origin, allowedOrigins) => {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
};

const createCorsMiddleware = () => {
  const cors = require("cors");
  const allowedOrigins = parseOriginsFromEnv();
  const allowAll = process.env.CORS_ALLOW_ALL === "true";

  if (allowAll) {
    console.warn("[CORS] CORS_ALLOW_ALL=true — all origins allowed (use only in local dev)");
    return cors();
  }

  console.log("[CORS] Allowed origins:", allowedOrigins.join(", "));

  return cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Blocked origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });
};

module.exports = {
  parseOriginsFromEnv,
  createCorsMiddleware,
};
