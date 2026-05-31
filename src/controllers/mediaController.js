const { GetObjectCommand } = require("@aws-sdk/client-s3");
const { createR2Client, getR2Config, extractObjectKeyFromUrl } = require("../utils/r2Client");
const { getMediaBaseUrl, rewriteM3u8Content, getContentTypeForKey } = require("../utils/mediaProxy");

const decodeObjectKeyFromRequest = (req) => {
  const rawPath = req.path.replace(/^\/+/, "");
  if (!rawPath) return "";
  return decodeURIComponent(rawPath);
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const streamMedia = async (req, res) => {
  const objectKey = decodeObjectKeyFromRequest(req);
  if (!objectKey) {
    return res.status(400).json({ error: "Media object key is required" });
  }

  try {
    const client = createR2Client();
    const { bucket } = getR2Config();
    const rangeHeader = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const result = await client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      })
    );

    const contentType = result.ContentType || getContentTypeForKey(objectKey);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=3600");

    if (objectKey.endsWith(".m3u8")) {
      const playlistBody = await streamToBuffer(result.Body);
      const rewritten = rewriteM3u8Content(playlistBody.toString("utf8"), objectKey, getMediaBaseUrl(req));
      res.setHeader("Content-Length", Buffer.byteLength(rewritten, "utf8"));
      return res.status(200).send(rewritten);
    }

    if (rangeHeader && result.ContentRange) {
      res.setHeader("Content-Range", result.ContentRange);
      if (typeof result.ContentLength === "number") {
        res.setHeader("Content-Length", String(result.ContentLength));
      }
      res.status(206);
    } else if (typeof result.ContentLength === "number") {
      res.setHeader("Content-Length", String(result.ContentLength));
      res.status(200);
    } else {
      res.status(200);
    }

    if (result.Body && typeof result.Body.pipe === "function") {
      result.Body.pipe(res);
      return undefined;
    }

    const bodyBuffer = await streamToBuffer(result.Body);
    return res.send(bodyBuffer);
  } catch (error) {
    const statusCode = error?.name === "NoSuchKey" ? 404 : 500;
    return res.status(statusCode).json({
      error: statusCode === 404 ? "Media not found" : "Failed to stream media",
    });
  }
};

module.exports = {
  streamMedia,
  decodeObjectKeyFromRequest,
  extractObjectKeyFromUrl,
};
