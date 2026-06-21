const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const { uploadFileToR2, deleteFileFromR2 } = require("../utils/r2Client");
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

/** Scale down so the longest edge is at most maxEdge; never pad or crop. */
const buildScaleFilterForLongestEdge = (maxEdge) =>
  `scale=w='if(gt(iw\\,ih)\\,${maxEdge}\\,-2)':h='if(gt(iw\\,ih)\\,-2\\,${maxEdge})'`;

const PREVIEW_SEGMENT_SECONDS = 5;
const PREVIEW_MIN_MULTI_SEGMENT_DURATION = 15;
const PREVIEW_LONG_VIDEO_SECONDS = 120;

const buildPreviewSegments = (duration) => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [{ start: 0, end: PREVIEW_SEGMENT_SECONDS }];
  }

  if (duration < PREVIEW_MIN_MULTI_SEGMENT_DURATION) {
    return [{ start: 0, end: duration }];
  }

  const midStart = Math.max(0, duration / 2 - PREVIEW_SEGMENT_SECONDS / 2);
  const lastStart =
    duration >= PREVIEW_LONG_VIDEO_SECONDS
      ? Math.max(0, duration - 60)
      : Math.max(0, duration - PREVIEW_SEGMENT_SECONDS);

  return [
    { start: 0, end: Math.min(PREVIEW_SEGMENT_SECONDS, duration) },
    { start: midStart, end: Math.min(midStart + PREVIEW_SEGMENT_SECONDS, duration) },
    { start: lastStart, end: Math.min(lastStart + PREVIEW_SEGMENT_SECONDS, duration) },
  ].filter((segment) => segment.end > segment.start);
};

const buildPreviewFilterComplex = (segments) => {
  const scaleFilter = buildScaleFilterForLongestEdge(360);

  if (segments.length === 1) {
    const { start, end } = segments[0];
    return `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${scaleFilter}[vout]`;
  }

  const trimParts = segments.map((segment, index) => {
    const start = Number(segment.start.toFixed(3));
    const end = Number(segment.end.toFixed(3));
    return `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`;
  });
  const concatInputs = segments.map((_, index) => `[v${index}]`).join("");
  return `${trimParts.join(";")};${concatInputs}concat=n=${segments.length}:v=1:a=0,${scaleFilter}[vout]`;
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
      sourceWidth: probe.width,
      sourceHeight: probe.height,
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

const THUMBNAIL_SHORT_VIDEO_THRESHOLD_SECONDS = 60;

const resolveDefaultThumbnailSeek = (durationSeconds) => {
  if (durationSeconds >= 30 && durationSeconds < THUMBNAIL_SHORT_VIDEO_THRESHOLD_SECONDS) {
    return 30;
  }
  if (durationSeconds > 12) return Math.min(8, Math.max(2, durationSeconds * 0.15));
  if (durationSeconds > 2) return 1;
  return 0;
};

const extractThumbnailFrameToFile = async ({
  localInputPath,
  seekSeconds,
  outputPath,
  sourceHeight = 0,
  durationSeconds = 0,
  serverConfig = null,
}) => {
  let resolvedHeight = sourceHeight;
  let duration = durationSeconds;
  if (!resolvedHeight || !duration) {
    const probe = await probeVideo(localInputPath);
    resolvedHeight = resolvedHeight || probe.height || 0;
    duration = duration || probe.durationSeconds || 0;
  }
  const safeSeek =
    duration > 0 ? Math.max(0, Math.min(seekSeconds, Math.max(0, duration - 0.05))) : Math.max(0, seekSeconds);

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

  const thumbArgs = ["-y", "-ss", String(safeSeek), "-i", localInputPath];
  const useLogo = useWatermark && watermark.mode === "logo" && logoPath;

  if (useWatermark) {
    if (useLogo) {
      thumbArgs.push("-i", logoPath);
    }
    const filter = buildThumbnailWatermarkFilter({
      watermark,
      hasLogoInput: Boolean(useLogo),
      sourceHeight: resolvedHeight,
    });
    thumbArgs.push("-filter_complex", filter, "-map", "[vout]", "-frames:v", "1", "-q:v", "2", outputPath);
  } else {
    thumbArgs.push("-frames:v", "1", "-q:v", "2", "-vf", buildScaleFilterForLongestEdge(1280), outputPath);
  }

  try {
    await execFileAsync(ffmpegPath, thumbArgs);
    if (!fs.existsSync(outputPath)) {
      throw new Error("Thumbnail frame was not created");
    }
  } finally {
    if (logoPath) {
      fs.rmSync(logoPath, { force: true });
    }
  }
};

const extractAndUploadThumbnailFromVideo = async ({
  localInputPath,
  title,
  serverConfig,
  seekSeconds,
  objectKeyPrefix = "",
}) => {
  const probe = await probeVideo(localInputPath);
  const duration = probe.durationSeconds > 0 ? probe.durationSeconds : 0;
  const resolvedSeek =
    typeof seekSeconds === "number" && Number.isFinite(seekSeconds)
      ? seekSeconds
      : resolveDefaultThumbnailSeek(duration);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-thumb-"));
  const outputPath = path.join(tempDir, "thumb.jpg");

  try {
    await extractThumbnailFrameToFile({
      localInputPath,
      seekSeconds: resolvedSeek,
      outputPath,
      sourceHeight: probe.height,
      durationSeconds: probe.durationSeconds,
      serverConfig,
    });

    const safeName = (title || "video").replace(/[^a-zA-Z0-9-_]/g, "-");
    const objectKey = objectKeyPrefix
      ? `${objectKeyPrefix.replace(/\/$/, "")}/${Math.round(resolvedSeek)}s-${safeName}.jpg`
      : `images/thumbnails/auto-${Date.now()}-${Math.round(resolvedSeek)}s-${safeName}.jpg`;
    const uploaded = await uploadFileToR2({
      localFilePath: outputPath,
      objectKey,
      contentType: "image/jpeg",
      serverConfig,
    });

    return { ...uploaded, seekSeconds: resolvedSeek };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const extractAndUploadPreviewClipFromVideo = async ({
  localInputPath,
  remoteInputUrl,
  title,
  serverConfig,
  durationSeconds = 0,
  sourceWidth = 0,
  sourceHeight = 0,
}) => {
  const inputSource = localInputPath || remoteInputUrl;
  if (!inputSource) {
    throw new Error("Video input is required");
  }

  const probe =
    durationSeconds > 0 && sourceWidth > 0 && sourceHeight > 0
      ? { durationSeconds, width: sourceWidth, height: sourceHeight }
      : await probeVideo(inputSource);
  const duration = probe.durationSeconds > 0 ? probe.durationSeconds : 0;
  const segments = buildPreviewSegments(duration);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ott-preview-"));
  const outputPath = path.join(tempDir, "preview.mp4");

  try {
    await execFileAsync(ffmpegPath, [
      "-y",
      "-i",
      inputSource,
      "-filter_complex",
      buildPreviewFilterComplex(segments),
      "-map",
      "[vout]",
      "-an",
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
  probeVideo,
  buildPreviewSegments,
};
