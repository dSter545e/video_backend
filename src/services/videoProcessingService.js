const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static").path;
const { uploadFileToR2, deleteFileFromR2 } = require("../utils/r2Client");

const QUALITY_LADDER = [144, 240, 360, 480, 720, 1080];
const BANDWIDTH_BY_HEIGHT = {
  144: 250000,
  240: 450000,
  360: 800000,
  480: 1400000,
  720: 2800000,
  1080: 5000000,
};

const execFileAsync = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
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

const transcodeVariantToHls = async ({ inputPath, outputPlaylistPath, targetHeight, segmentPatternPath }) => {
  const args = [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=-2:${targetHeight}`,
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
    outputPlaylistPath,
  ];
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
        await deleteFileFromR2(key);
      } catch (_cleanupError) {
        // ignore cleanup failure
      }
    }
    if (error.message === "VIDEO_PROCESS_CANCELLED") {
      throw error;
    }
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

module.exports = {
  processAndUploadVideoVariants,
};
