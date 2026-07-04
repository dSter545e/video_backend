const isLocalHostname = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const ensureHttpsUrl = (url) => {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" && !isLocalHostname(parsed.hostname)) {
      parsed.protocol = "https:";
      return parsed.toString();
    }
  } catch (_error) {
    // Keep original URL when parsing fails.
  }
  return url;
};

let cachedCdnBaseUrl = null;

const normalizeBaseUrl = (value) => {
  const trimmed = String(value || "").trim().replace(/\/$/, "");
  return trimmed ? ensureHttpsUrl(trimmed) : null;
};

const resolveFromStorage = async () => {
  const StorageServer = require("../models/StorageServer");
  const server =
    (await StorageServer.findOne({ isDefault: true, isActive: true })) ||
    (await StorageServer.findOne({ isActive: true }).sort({ createdAt: 1 }));

  const base = server?.publicBaseUrl?.trim();
  if (!base) return null;

  // Internal R2 API host is not a browser-facing CDN URL.
  if (base.includes(".r2.cloudflarestorage.com")) return null;

  return normalizeBaseUrl(base);
};

const refreshMediaCdnCache = async () => {
  const envUrl = process.env.MEDIA_CDN_URL?.trim();
  if (envUrl) {
    cachedCdnBaseUrl = normalizeBaseUrl(envUrl);
    return cachedCdnBaseUrl;
  }

  cachedCdnBaseUrl = await resolveFromStorage();
  return cachedCdnBaseUrl;
};

/** Sync read: env var first, then warmed storage cache. */
const getMediaCdnBaseUrl = () => {
  const envUrl = process.env.MEDIA_CDN_URL?.trim();
  if (envUrl) return normalizeBaseUrl(envUrl);
  return cachedCdnBaseUrl;
};

const usesMediaCdn = () => Boolean(getMediaCdnBaseUrl());

module.exports = {
  refreshMediaCdnCache,
  getMediaCdnBaseUrl,
  usesMediaCdn,
};
