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

/** Optional: allow any origin whose host ends with this suffix (e.g. .xhub4u.com). */
const parseOriginSuffix = () => {
  const raw = (process.env.CORS_ORIGIN_SUFFIX || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return raw.startsWith(".") ? raw : `.${raw}`;
};

const isOriginAllowed = (origin, allowedOrigins, originSuffix) => {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (!originSuffix) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname.endsWith(originSuffix) || hostname === originSuffix.slice(1);
  } catch {
    return false;
  }
};

const createCorsMiddleware = () => {
  const cors = require("cors");
  const allowedOrigins = parseOriginsFromEnv();
  const originSuffix = parseOriginSuffix();
  const allowAll = process.env.CORS_ALLOW_ALL === "true";

  if (allowAll) {
    console.warn("[CORS] CORS_ALLOW_ALL=true — all origins allowed (use only in local dev)");
    return cors();
  }

  console.log("[CORS] Allowed origins:", allowedOrigins.join(", "));
  if (originSuffix) {
    console.log("[CORS] Also allowing origins ending with:", originSuffix);
  }

  return cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins, originSuffix)) {
        callback(null, true);
      } else {
        console.warn(`[CORS] Blocked origin: ${origin}`);
        callback(null, false);
      }
    },
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  });
};

module.exports = {
  parseOriginsFromEnv,
  parseOriginSuffix,
  isOriginAllowed,
  createCorsMiddleware,
};
