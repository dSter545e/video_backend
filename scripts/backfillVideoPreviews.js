const dotenv = require("dotenv");
dotenv.config();

const fs = require("fs");
const connectDB = require("../src/config/db");
const Video = require("../src/models/Video");
const StorageServer = require("../src/models/StorageServer");
const {
  extractAndUploadPreviewClipFromVideo,
  prepareLocalVideoInputForPreview,
} = require("../src/services/videoProcessingService");
const { deleteFileFromR2, getDefaultStorageServer } = require("../src/utils/r2Client");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const regenerateAll = args.includes("--regenerate");
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
  const idArg = args.find((arg) => arg.startsWith("--id="));
  const videoId = idArg ? idArg.split("=")[1] : "";

  return {
    regenerateAll,
    dryRun,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    videoId: videoId.trim(),
  };
};

const resolveServerConfig = async (storageServerId) => {
  if (storageServerId) {
    const server = await StorageServer.findById(storageServerId);
    if (server?.isActive) return server.toObject();
  }

  const defaultServer = await getDefaultStorageServer();
  return defaultServer?.isActive ? defaultServer.toObject() : null;
};

const hasHlsSource = (video) => {
  const hasVariant = (video.qualityVariants || []).some(
    (variant) =>
      (typeof variant?.url === "string" && variant.url.includes(".m3u8")) ||
      (typeof variant?.key === "string" && variant.key.endsWith(".m3u8"))
  );
  const hasMaster = typeof video.videoUrl === "string" && video.videoUrl.includes(".m3u8");
  const hasHlsKeys = Array.isArray(video.hlsKeys) && video.hlsKeys.some((key) => String(key).endsWith(".m3u8"));
  return hasVariant || hasMaster || hasHlsKeys;
};

const backfillVideoPreviews = async () => {
  const { regenerateAll, dryRun, limit, videoId } = parseArgs();

  await connectDB();

  const query = videoId
    ? { _id: videoId }
    : regenerateAll
      ? {}
      : { $or: [{ previewUrl: "" }, { previewUrl: { $exists: false } }, { previewUrl: null }] };

  let finder = Video.find(query).sort({ createdAt: 1 });
  if (limit > 0) {
    finder = finder.limit(limit);
  }

  const videos = await finder;
  if (!videos.length) {
    console.log("No videos matched the backfill criteria.");
    process.exit(0);
  }

  console.log(
    `Starting preview backfill for ${videos.length} video(s)` +
      `${regenerateAll ? " (regenerate all)" : ""}` +
      `${dryRun ? " [dry-run]" : ""}`
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const video of videos) {
    if (!hasHlsSource(video)) {
      skipped += 1;
      console.log(`[skip] ${video._id} — no HLS source found (${video.title})`);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${video._id} — would generate preview from stored HLS files (${video.title})`);
      succeeded += 1;
      continue;
    }

    const serverConfig = await resolveServerConfig(video.storageServer);
    if (!serverConfig) {
      skipped += 1;
      console.log(`[skip] ${video._id} — no active storage server (${video.title})`);
      continue;
    }

    const previousPreviewKey = video.previewKey;
    let inputCleanupDir = "";

    try {
      const localInput = await prepareLocalVideoInputForPreview({ video, serverConfig });
      inputCleanupDir = localInput.cleanupDir;

      const preview = await extractAndUploadPreviewClipFromVideo({
        localInputPath: localInput.localInputPath,
        title: video.title,
        serverConfig,
        durationSeconds: video.durationSeconds,
      });

      await Video.findByIdAndUpdate(video._id, {
        $set: {
          previewUrl: preview.url,
          previewKey: preview.key,
        },
      });

      if (previousPreviewKey && previousPreviewKey !== preview.key) {
        try {
          await deleteFileFromR2(previousPreviewKey, serverConfig);
        } catch (_cleanupError) {
          // ignore cleanup failure
        }
      }

      succeeded += 1;
      console.log(`[ok] ${video._id} — ${video.title}`);
    } catch (error) {
      failed += 1;
      console.error(`[fail] ${video._id} — ${video.title}: ${error.message}`);
    } finally {
      if (inputCleanupDir) {
        try {
          fs.rmSync(inputCleanupDir, { recursive: true, force: true });
        } catch (_cleanupError) {
          // ignore cleanup failure
        }
      }
    }
  }

  console.log("");
  console.log(`Done. succeeded=${succeeded} failed=${failed} skipped=${skipped} total=${videos.length}`);
  process.exit(failed > 0 ? 1 : 0);
};

backfillVideoPreviews().catch((error) => {
  console.error("Preview backfill crashed:", error.message);
  process.exit(1);
});
