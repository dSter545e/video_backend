const { extractObjectKeyFromUrl } = require("./r2Client");
const { getMediaCdnBaseUrl, usesMediaCdn } = require("./mediaCdnResolver");

const isLocalHostname = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const shouldForceHttps = () => process.env.MEDIA_FORCE_HTTP !== "true";

const ensureHttpsUrl = (url) => {
  if (!url || !shouldForceHttps()) return url;
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

const getRequestProtocol = (req) => {
  const forwarded = req?.get?.("x-forwarded-proto");
  if (forwarded) {
    return String(forwarded).split(",")[0].trim() || "http";
  }
  return req?.protocol || "http";
};

const getMediaBaseUrl = (req) => {
  const cdnBase = getMediaCdnBaseUrl();
  if (cdnBase) return cdnBase;

  const configured = process.env.API_PUBLIC_URL?.trim();
  if (configured) {
    return ensureHttpsUrl(`${configured.replace(/\/$/, "")}/api/media`);
  }

  const siteUrl = process.env.USER_SITE_URL || process.env.FRONTEND_URL;
  const requestHost = String(req.get("host") || "");
  const requestHostname = requestHost.split(":")[0].toLowerCase();

  if (siteUrl) {
    try {
      const site = new URL(siteUrl);
      const siteHostname = site.hostname.toLowerCase();
      if (siteHostname === requestHostname && !/^api\./i.test(siteHostname)) {
        const derived = `${site.protocol}//api.${siteHostname.replace(/^www\./i, "")}`;
        return ensureHttpsUrl(`${derived}/api/media`);
      }
    } catch (_error) {
      // Fall through to request host.
    }
  }

  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[mediaProxy] API_PUBLIC_URL is not set. Set it to your public backend origin (same as NEXT_PUBLIC_MEDIA_API_URL / api subdomain)."
    );
  }

  const protocol = getRequestProtocol(req);
  return ensureHttpsUrl(`${protocol}://${requestHost}/api/media`);
};

const buildMediaPublicUrl = (mediaBaseUrl, objectKey) => {
  const encodedPath = String(objectKey || "")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return ensureHttpsUrl(`${mediaBaseUrl.replace(/\/$/, "")}/${encodedPath}`);
};

/** @deprecated use buildMediaPublicUrl */
const buildMediaProxyUrl = (mediaBaseUrl, objectKey) => buildMediaPublicUrl(mediaBaseUrl, objectKey);

const isMediaProxyUrl = (url) => {
  try {
    return new URL(url).pathname.includes("/api/media/");
  } catch (_error) {
    return false;
  }
};

const extractMediaObjectKeyFromProxyUrl = (url) => {
  try {
    const pathname = new URL(url).pathname;
    const prefix = "/api/media/";
    const index = pathname.indexOf(prefix);
    if (index === -1) return "";
    return decodeURIComponent(pathname.slice(index + prefix.length));
  } catch (_error) {
    return "";
  }
};

const isR2MediaUrl = (url) => {
  if (!url || typeof url !== "string") return false;
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".r2.dev") || hostname.includes("r2.cloudflarestorage.com");
  } catch (_error) {
    return false;
  }
};

const rewriteStreamUrl = (url, mediaBaseUrl) => {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!trimmed || trimmed === "about:blank") return trimmed;

  if (isMediaProxyUrl(trimmed)) {
    const proxyKey = extractMediaObjectKeyFromProxyUrl(trimmed);
    if (proxyKey) return buildMediaPublicUrl(mediaBaseUrl, proxyKey);
  }

  if (isR2MediaUrl(trimmed)) {
    const objectKey = extractObjectKeyFromUrl(trimmed);
    if (!objectKey) return ensureHttpsUrl(trimmed);
    return buildMediaPublicUrl(mediaBaseUrl, objectKey);
  }

  return ensureHttpsUrl(trimmed);
};

const toPlainVideo = (video) => (video && typeof video.toObject === "function" ? video.toObject() : video);

const withMediaProxyUrls = (video, req) => {
  if (!video || !req) return video;
  const mediaBaseUrl = getMediaBaseUrl(req);
  const nextVideo = { ...toPlainVideo(video) };

  if (nextVideo.videoUrl) {
    nextVideo.videoUrl = rewriteStreamUrl(nextVideo.videoUrl, mediaBaseUrl);
  }

  if (nextVideo.previewUrl) {
    nextVideo.previewUrl = rewriteStreamUrl(nextVideo.previewUrl, mediaBaseUrl);
  }

  if (nextVideo.thumbnail) {
    nextVideo.thumbnail = rewriteStreamUrl(nextVideo.thumbnail, mediaBaseUrl);
  }

  if (Array.isArray(nextVideo.qualityVariants)) {
    nextVideo.qualityVariants = nextVideo.qualityVariants.map((variant) => ({
      ...variant,
      url: variant?.url ? rewriteStreamUrl(variant.url, mediaBaseUrl) : variant?.url,
    }));
  }

  if (Array.isArray(nextVideo.recommendedVideos)) {
    nextVideo.recommendedVideos = withMediaProxyUrlsList(nextVideo.recommendedVideos, req);
  }

  return nextVideo;
};

const withMediaProxyUrlsList = (videos, req) => {
  if (!Array.isArray(videos) || !req) return videos;
  return videos.map((video) => withMediaProxyUrls(video, req));
};

const resolveRelativePlaylistUri = (uri, playlistKey) => {
  const trimmed = String(uri || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    return extractObjectKeyFromUrl(trimmed) || trimmed;
  }

  const normalizedPlaylistKey = String(playlistKey || "").replace(/^\/+/, "");
  const playlistDir = normalizedPlaylistKey.includes("/")
    ? normalizedPlaylistKey.slice(0, normalizedPlaylistKey.lastIndexOf("/") + 1)
    : "";

  return `${playlistDir}${trimmed}`.replace(/\/+/g, "/").replace(/^\//, "");
};

const rewriteM3u8Content = (content, playlistKey, mediaBaseUrl) => {
  const lines = String(content || "").split(/\r?\n/);
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;

      const resolvedKey = resolveRelativePlaylistUri(trimmed, playlistKey);
      if (/^https?:\/\//i.test(resolvedKey)) {
        return rewriteStreamUrl(resolvedKey, mediaBaseUrl);
      }
      return buildMediaPublicUrl(mediaBaseUrl, resolvedKey);
    })
    .join("\n");
};

const getContentTypeForKey = (objectKey) => {
  const fileName = String(objectKey || "").toLowerCase();
  if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (fileName.endsWith(".ts")) return "video/mp2t";
  if (fileName.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
};

module.exports = {
  getMediaBaseUrl,
  getMediaCdnBaseUrl,
  usesMediaCdn,
  buildMediaPublicUrl,
  buildMediaProxyUrl,
  isR2MediaUrl,
  rewriteStreamUrl,
  ensureHttpsUrl,
  withMediaProxyUrls,
  withMediaProxyUrlsList,
  rewriteM3u8Content,
  getContentTypeForKey,
};
