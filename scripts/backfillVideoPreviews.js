const dotenv = require("dotenv");
dotenv.config();

const connectDB = require("../src/config/db");
const Video = require("../src/models/Video");
const StorageServer = require("../src/models/StorageServer");
const { extractAndUploadPreviewClipFromVideo } = require("../src/services/videoProcessingService");
const { deleteFileFromR2 } = require("../src/utils/r2Client");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 0;
  const idArg = args.find((arg) => arg.startsWith("--id="));
  const videoId = idArg ? idArg.split("=")[1] : "";

  return {
    force,
    dryRun,
    limit: Number.isFinite(limit) && limit > 0 ? limit : 0,
    videoId: videoId.trim(),
  };
};

const resolveServerConfig = async (storageServerId) => {
  if (!storageServerId) return null;
  const server = await StorageServer.findById(storageServerId);
  return server?.isActive ? server.toObject() : null;
};

const pickStreamSource = (video) => {
  const variants = [...(video.qualityVariants || [])]
    .filter((variant) => typeof variant.url === "string" && variant.url.includes(".m3u8"))
    .sort((a, b) => (a.height || 0) - (b.height || 0));

  if (variants[0]?.url) {
    return variants[0].url;
  }

  if (typeof video.videoUrl === "string" && video.videoUrl.includes(".m3u8")) {
    return video.videoUrl;
  }

  return "";
};

const backfillVideoPreviews = async () => {
  const { force, dryRun, limit, videoId } = parseArgs();

  await connectDB();

  const query = videoId
    ? { _id: videoId }
    : force
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
      `${force ? " (force regenerate)" : ""}` +
      `${dryRun ? " [dry-run]" : ""}`
  );

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const video of videos) {
    const streamSource = pickStreamSource(video);
    if (!streamSource) {
      skipped += 1;
      console.log(`[skip] ${video._id} — no HLS source found (${video.title})`);
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ${video._id} — would generate preview from ${streamSource}`);
      succeeded += 1;
      continue;
    }

    const serverConfig = await resolveServerConfig(video.storageServer);
    const previousPreviewKey = video.previewKey;

    try {
      const preview = await extractAndUploadPreviewClipFromVideo({
        remoteInputUrl: streamSource,
        title: video.title,
        serverConfig,
        durationSeconds: video.durationSeconds,
      });

      video.previewUrl = preview.url;
      video.previewKey = preview.key;
      await video.save();

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
