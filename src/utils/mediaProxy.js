const { extractObjectKeyFromUrl } = require("./r2Client");

const getMediaBaseUrl = (req) => {
  const configured = process.env.API_PUBLIC_URL;
  if (configured) {
    return `${configured.replace(/\/$/, "")}/api/media`;
  }
  const host = req.get("host");
  const protocol = req.protocol || "http";
  return `${protocol}://${host}/api/media`;
};

const buildMediaProxyUrl = (mediaBaseUrl, objectKey) => {
  const encodedPath = String(objectKey || "")
    .replace(/^\/+/, "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${mediaBaseUrl}/${encodedPath}`;
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
  if (!isR2MediaUrl(url)) return url;
  const objectKey = extractObjectKeyFromUrl(url);
  if (!objectKey) return url;
  return buildMediaProxyUrl(mediaBaseUrl, objectKey);
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
      return buildMediaProxyUrl(mediaBaseUrl, resolvedKey);
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
  buildMediaProxyUrl,
  isR2MediaUrl,
  rewriteStreamUrl,
  withMediaProxyUrls,
  withMediaProxyUrlsList,
  rewriteM3u8Content,
  getContentTypeForKey,
};
