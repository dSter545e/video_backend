const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const { uploadFileToR2, deleteFileFromR2, downloadFileFromR2, listFilesFromR2, extractObjectKeyFromUrl } = require("../utils/r2Client");
const {
  getWatermarkSettings,
  isWatermarkActive,
  buildVariantWatermarkFilter,
  buildThumbnailWatermarkFilter,
  prepareWatermarkLogoFile,
} = require("./watermarkService");

const QUALITY_LADDER = [144, 240, 360, 480, 720, 1080];
const BANDWIDTH_BY_HEIGHT = {
  144: 250000,
  240: 450000,
  360: 800000,
  480: 1400000,
  720: 2800000,
  1080: 5000000,
};

const formatFfmpegError = (stderr, fallback) => {
  const skipPrefixes = ["ffmpeg version", "built with", "configuration:", "libav", "libsw", "libpostproc"];
  const lines = String(stderr || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !skipPrefixes.some((prefix) => line.startsWith(prefix)));

  const message = lines.slice(-6).join(" ").trim();
  return message || fallback || "ffmpeg failed";
};

const execFileAsync = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(formatFfmpegError(stderr, error.message)));
        return;
      }
      resolve(stdout);
    });
  });

const getObjectPrefixFromKey = (objectKey) => {
  const normalized = String(objectKey || "").replace(/^\/+/, "");
  if (!normalized.includes("/")) return "";
  return normalized.slice(0, normalized.lastIndexOf("/") + 1);
};

const downloadR2PrefixToLocalDir = async ({ prefix, targetDir, serverConfig }) => {
  const items = await listFilesFromR2(prefix, serverConfig);
  if (!items.length) {
    throw new Error(`No storage files found under ${prefix}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  for (const item of items) {
    if (!item.key) continue;
    const relativePath = item.key.startsWith(prefix) ? item.key.slice(prefix.length) : path.basename(item.key);
    const localPath = path.join(targetDir, relativePath);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    const buffer = await downloadFileFromR2(item.key, serverConfig);
    fs.writeFileSync(localPath, buffer);
  }

  return items;
};

const resolveHlsPlaylistKey = (video) => {
  const variants = [...(video.qualityVariants || [])]
    .filter((variant) => variant?.key || variant?.url)
    .sort((a, b) => (a.height || 0) - (b.height || 0));

  for (const variant of variants) {
    const objectKey = variant.key || extractObjectKeyFromUrl(variant.url);
    if (objectKey && objectKey.endsWith(".m3u8")) {
      return objectKey;
    }
  }

  if (typeof video.videoUrl === "string" && video.videoUrl.includes(".m3u8")) {
    return extractObjectKeyFromUrl(video.videoUrl);
  }

  if (Array.isArray(video.hlsKeys)) {
    const variantPlaylist = video.hlsKeys.find((key) => /\/\d+p\.m3u8$/i.test(String(key)));
    if (variantPlaylist) return variantPlaylist;
    const masterPlaylist = video.hlsKeys.find((key) => String(key).endsWith("master.m3u8"));
    if (masterPlaylist) return masterPlaylist;
  }

  return "";
};

const prepareLocalVideoInputForPreview = async ({ video, serverConfig }) => {
  const objectKey = resolveHlsPlaylistKey(video);
  if (!objectKey) {
    throw new Error("No HLS playlist key found for preview generation");
  }

  const prefix = getObjectPrefixFromKey(objectKey);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-hls-input-"));
  await downloadR2PrefixToLocalDir({ prefix, targetDir: tempDir, serverConfig });

  const localPlaylist = path.join(tempDir, path.basename(objectKey));
  if (!fs.existsSync(localPlaylist)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw new Error(`Downloaded playlist missing: ${path.basename(objectKey)}`);
  }

  return { localInputPath: localPlaylist, cleanupDir: tempDir };
};

const probeVideo = async (inputPath) => {
  const output = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    inputPath,
  ]);

  const parsed = JSON.parse(output);
  const videoStream = (parsed.streams || []).find((stream) => stream.codec_type === "video");
  if (!videoStream) {
    throw new Error("No video stream found");
  }

  return {
    width: Number(videoStream.width || 0),
    height: Number(videoStream.height || 0),
    durationSeconds: Number(videoStream.duration || 0),
  };
};

const getTargetHeights = (sourceHeight) => {
  const targets = QUALITY_LADDER.filter((height) => height <= sourceHeight);
  if (targets.length === 0 && sourceHeight > 0) {
    return [sourceHeight];
  }
  return targets;
};

const transcodeVariantToHls = async ({
  inputPath,
  outputPlaylistPath,
  targetHeight,
  segmentPatternPath,
  watermark,
  logoPath,
}) => {
  const args = ["-y", "-i", inputPath];
  const useWatermark = isWatermarkActive(watermark);
  const useLogo = useWatermark && watermark.mode === "logo" && logoPath;

  if (useWatermark) {
    if (useLogo) {
      args.push("-i", logoPath);
    }
    const filter = buildVariantWatermarkFilter({
      targetHeight,
      watermark,
      hasLogoInput: Boolean(useLogo),
    });
    args.push("-filter_complex", filter, "-map", "[vout]", "-map", "0:a?");
  } else {
    args.push("-vf", `scale=-2:${targetHeight}`, "-map", "0:v:0", "-map", "0:a?");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-hls_time",
    "10",
    "-hls_playlist_type",
    "vod",
    "-hls_segment_filename",
    segmentPatternPath,
    outputPlaylistPath
  );
  await execFileAsync(ffmpegPath, args);
};

const getMimeTypeFromFileName = (fileName) => {
  if (fileName.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (fileName.endsWith(".ts")) return "video/mp2t";
  return "application/octet-stream";
};

const processAndUploadVideoVariants = async ({
  localInputPath,
  originalName,
  title,
  serverConfig,
  onVariantProgress,
  shouldAbort,
  onVariantStart,
  onVariantTranscoded,
  onVariantUploaded,
  onVariantPlan,
}) => {
  const probe = await probeVideo(localInputPath);
  const targetHeights = getTargetHeights(probe.height);
  onVariantPlan?.({
    total: targetHeights.length,
    heights: targetHeights,
  });

  const watermark = await getWatermarkSettings();
  let logoPath = null;
  if (isWatermarkActive(watermark) && watermark.mode === "logo") {
    try {
      logoPath = await prepareWatermarkLogoFile({ watermark, serverConfig });
    } catch (error) {
      console.warn("[video-processing] Watermark logo unavailable, continuing without logo:", error.message);
    }
  }

  const baseName = `${Date.now()}-${(title || originalName || "video").replace(/[^a-zA-Z0-9-_]/g, "-")}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-variants-"));
  const uploadedHlsKeys = [];

  try {
    const variants = [];
    const masterPlaylistLines = ["#EXTM3U", "#EXT-X-VERSION:3"];

    for (const height of targetHeights) {
      if (shouldAbort?.()) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }
      const variantDir = path.join(tempDir, `${height}p`);
      fs.mkdirSync(variantDir, { recursive: true });
      const outputFileName = `${height}p.m3u8`;
      const outputPath = path.join(variantDir, outputFileName);
      const segmentPatternPath = path.join(variantDir, `${height}p_%03d.ts`);
      const variantLabel = `${height}p`;
      const transcodeStartedAt = Date.now();
      onVariantStart?.({
        label: variantLabel,
        targetHeight: height,
        outputPath,
      });

      await transcodeVariantToHls({
        inputPath: localInputPath,
        outputPlaylistPath: outputPath,
        targetHeight: height,
        segmentPatternPath,
        watermark,
        logoPath,
      });
      const transcodedSizeBytes = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
      onVariantTranscoded?.({
        label: variantLabel,
        targetHeight: height,
        elapsedSec: Number(((Date.now() - transcodeStartedAt) / 1000).toFixed(1)),
        sizeMB: Number((transcodedSizeBytes / (1024 * 1024)).toFixed(2)),
      });
      if (shouldAbort?.()) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }

      const variantFiles = fs.readdirSync(variantDir).sort();
      let uploadedPlaylistUrl = "";
      let uploadedPlaylistKey = "";
      for (let index = 0; index < variantFiles.length; index += 1) {
        const variantFileName = variantFiles[index];
        const localVariantPath = path.join(variantDir, variantFileName);
        const objectKey = `videos/${baseName}/${height}p/${variantFileName}`;
        const uploaded = await uploadFileToR2({
          localFilePath: localVariantPath,
          objectKey,
          contentType: getMimeTypeFromFileName(variantFileName),
          onProgress:
            index === variantFiles.length - 1
              ? (progress) => {
                  onVariantProgress?.({
                    label: variantLabel,
                    objectKey,
                    ...progress,
                  });
                }
              : undefined,
          serverConfig,
        });
        uploadedHlsKeys.push(uploaded.key);
        if (variantFileName.endsWith(".m3u8")) {
          uploadedPlaylistUrl = uploaded.url;
          uploadedPlaylistKey = uploaded.key;
        }
      }

      variants.push({
        label: variantLabel,
        height,
        width: 0,
        url: uploadedPlaylistUrl,
        key: uploadedPlaylistKey,
      });
      masterPlaylistLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${BANDWIDTH_BY_HEIGHT[height] || 1200000},RESOLUTION=0x${height}`,
        `${height}p/${outputFileName}`
      );
      onVariantUploaded?.({
        label: variantLabel,
        key: uploadedPlaylistKey,
        url: uploadedPlaylistUrl,
      });
    }

    const sorted = variants.sort((a, b) => a.height - b.height);
    const masterPlaylistPath = path.join(tempDir, "master.m3u8");
    fs.writeFileSync(masterPlaylistPath, `${masterPlaylistLines.join("\n")}\n`, "utf8");
    const masterObjectKey = `videos/${baseName}/master.m3u8`;
    const uploadedMaster = await uploadFileToR2({
      localFilePath: masterPlaylistPath,
      objectKey: masterObjectKey,
      contentType: "application/vnd.apple.mpegurl",
      serverConfig,
    });
    uploadedHlsKeys.push(uploadedMaster.key);

    return {
      variants: sorted,
      masterUrl: uploadedMaster.url,
      masterKey: uploadedMaster.key,
      hlsKeys: uploadedHlsKeys,
      maxSourceHeight: probe.height,
      durationSeconds: probe.durationSeconds,
    };
  } catch (error) {
    for (const key of uploadedHlsKeys) {
      try {
        await deleteFileFromR2(key, serverConfig);
      } catch (_cleanupError) {
        // ignore cleanup failure
      }
    }
    if (error.message === "VIDEO_PROCESS_CANCELLED") {
      throw error;
    }
    throw error;
  } finally {
    if (logoPath) {
      fs.rmSync(logoPath, { force: true });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const extractAndUploadThumbnailFromVideo = async ({ localInputPath, title, serverConfig }) => {
  const probe = await probeVideo(localInputPath);
  const duration = probe.durationSeconds > 0 ? probe.durationSeconds : 0;
  const seekSeconds =
    duration > 12 ? Math.min(8, Math.max(2, duration * 0.15)) : duration > 2 ? 1 : 0;

  const watermark = await getWatermarkSettings();
  const useWatermark = isWatermarkActive(watermark);
  let logoPath = null;
  if (useWatermark && watermark.mode === "logo") {
    try {
      logoPath = await prepareWatermarkLogoFile({ watermark, serverConfig });
    } catch (error) {
      console.warn("[video-processing] Thumbnail watermark logo unavailable:", error.message);
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-thumb-"));
  const outputPath = path.join(tempDir, "thumb.jpg");

  try {
    const thumbArgs = ["-y", "-ss", String(seekSeconds), "-i", localInputPath];
    const useLogo = useWatermark && watermark.mode === "logo" && logoPath;

    if (useWatermark) {
      if (useLogo) {
        thumbArgs.push("-i", logoPath);
      }
      const filter = buildThumbnailWatermarkFilter({ watermark, hasLogoInput: Boolean(useLogo) });
      thumbArgs.push("-filter_complex", filter, "-map", "[vout]", "-frames:v", "1", "-q:v", "2", outputPath);
    } else {
      thumbArgs.push("-frames:v", "1", "-q:v", "2", "-vf", "scale=1280:-2", outputPath);
    }

    await execFileAsync(ffmpegPath, thumbArgs);

    if (!fs.existsSync(outputPath)) {
      throw new Error("Thumbnail frame was not created");
    }

    const safeName = (title || "video").replace(/[^a-zA-Z0-9-_]/g, "-");
    const objectKey = `images/thumbnails/auto-${Date.now()}-${safeName}.jpg`;
    const uploaded = await uploadFileToR2({
      localFilePath: outputPath,
      objectKey,
      contentType: "image/jpeg",
      serverConfig,
    });

    return uploaded;
  } finally {
    if (logoPath) {
      fs.rmSync(logoPath, { force: true });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const extractAndUploadPreviewClipFromVideo = async ({
  localInputPath,
  remoteInputUrl,
  title,
  serverConfig,
  durationSeconds = 0,
}) => {
  const inputSource = localInputPath || remoteInputUrl;
  if (!inputSource) {
    throw new Error("Video input is required");
  }

  const probe = durationSeconds > 0 ? { durationSeconds } : await probeVideo(inputSource);
  const duration = probe.durationSeconds > 0 ? probe.durationSeconds : 0;
  const clipLength = Math.min(6, duration > 0 ? duration : 6);
  const seekSeconds =
    duration > 12 ? Math.min(8, Math.max(2, duration * 0.15)) : duration > 2 ? 1 : 0;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-preview-"));
  const outputPath = path.join(tempDir, "preview.mp4");

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputSource,
      "-ss",
      String(seekSeconds),
      "-t",
      String(clipLength),
      "-an",
      "-vf",
      "scale=-2:360",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    if (!fs.existsSync(outputPath)) {
      throw new Error("Preview clip was not created");
    }

    const safeName = (title || "video").replace(/[^a-zA-Z0-9-_]/g, "-");
    const objectKey = `videos/previews/${Date.now()}-${safeName}.mp4`;
    const uploaded = await uploadFileToR2({
      localFilePath: outputPath,
      objectKey,
      contentType: "video/mp4",
      serverConfig,
    });

    return uploaded;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

module.exports = {
  processAndUploadVideoVariants,
  extractAndUploadThumbnailFromVideo,
  extractAndUploadPreviewClipFromVideo,
  prepareLocalVideoInputForPreview,
  probeVideo,
};
