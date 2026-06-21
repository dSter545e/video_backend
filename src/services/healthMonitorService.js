const StorageServer = require("../models/StorageServer");
const Video = require("../models/Video");
const HealthMonitorSnapshot = require("../models/HealthMonitorSnapshot");
const { headBucketInR2, headObjectInR2, extractObjectKeyFromUrl, getDefaultStorageServer } = require("../utils/r2Client");

const SNAPSHOT_KEY = "latest";
const DEFAULT_INTERVAL_HOURS = 24;

const getIntervalMs = () => {
  const hours = Number.parseInt(String(process.env.HEALTH_CHECK_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS), 10);
  return Math.max(1, Number.isFinite(hours) ? hours : DEFAULT_INTERVAL_HOURS) * 60 * 60 * 1000;
};

const resolveVideoObjectKey = (video) => {
  const fromUrl = extractObjectKeyFromUrl(video.videoUrl);
  if (fromUrl && fromUrl.endsWith(".m3u8")) return fromUrl;
  if (Array.isArray(video.hlsKeys) && video.hlsKeys.length) {
    const masterKey = video.hlsKeys.find((key) => String(key).endsWith("master.m3u8"));
    if (masterKey) return masterKey;
  }
  if (video.sourceVideoKey && String(video.sourceVideoKey).endsWith(".m3u8")) {
    return video.sourceVideoKey;
  }
  if (fromUrl) return fromUrl;
  if (Array.isArray(video.qualityVariants) && video.qualityVariants.length) {
    const variantKey = video.qualityVariants.find((item) => item?.key)?.key;
    if (variantKey) return variantKey;
  }
  return "";
};

const checkStorageServer = async (server) => {
  const checkedAt = new Date();
  if (!server.isActive) {
    return {
      serverId: server._id,
      name: server.name,
      bucketName: server.bucketName,
      status: "unknown",
      message: "Server is inactive",
      checkedAt,
    };
  }

  try {
    await headBucketInR2(server.toObject());
    server.healthStatus = "online";
    server.healthMessage = "Bucket reachable";
    server.healthCheckedAt = checkedAt;
    await server.save();
    return {
      serverId: server._id,
      name: server.name,
      bucketName: server.bucketName,
      status: "online",
      message: "Bucket reachable",
      checkedAt,
    };
  } catch (error) {
    server.healthStatus = "offline";
    server.healthMessage = error.message || "Connection failed";
    server.healthCheckedAt = checkedAt;
    await server.save();
    return {
      serverId: server._id,
      name: server.name,
      bucketName: server.bucketName,
      status: "offline",
      message: error.message || "Connection failed",
      checkedAt,
    };
  }
};

const resolveServerForVideo = async (video, serverMap) => {
  if (video.storageServer) {
    const cached = serverMap.get(String(video.storageServer));
    if (cached) return cached;
    const server = await StorageServer.findById(video.storageServer);
    if (server) {
      serverMap.set(String(server._id), server);
      return server;
    }
  }
  return null;
};

const updateVideoHealth = async (videoId, fields) => {
  await Video.findByIdAndUpdate(videoId, {
    $set: {
      healthStatus: fields.healthStatus,
      healthMessage: fields.healthMessage,
      healthCheckedAt: fields.healthCheckedAt,
    },
  });
};

const checkVideoHealth = async (video, serverMap) => {
  const checkedAt = new Date();
  const processingStates = ["processing", "draft"];
  const videoUrl = typeof video.videoUrl === "string" ? video.videoUrl.trim() : "";

  if (!videoUrl || processingStates.includes(video.processingStatus) || videoUrl === "about:blank") {
    const healthMessage = "Video is still processing or not published";
    await updateVideoHealth(video._id, {
      healthStatus: "processing",
      healthMessage,
      healthCheckedAt: checkedAt,
    });
    return { status: "processing", offline: false, message: healthMessage };
  }

  const objectKey = resolveVideoObjectKey(video);
  let server = await resolveServerForVideo(video, serverMap);
  if (!server) {
    server = await getDefaultStorageServer();
  }
  const serverConfig = server ? server.toObject() : null;

  if (!objectKey) {
    const healthMessage = "No media object key found";
    await updateVideoHealth(video._id, {
      healthStatus: "unknown",
      healthMessage,
      healthCheckedAt: checkedAt,
    });
    return { status: "unknown", offline: false, message: healthMessage };
  }

  try {
    await headObjectInR2(objectKey, serverConfig);
    const healthMessage = "Media file reachable in storage";
    await updateVideoHealth(video._id, {
      healthStatus: "online",
      healthMessage,
      healthCheckedAt: checkedAt,
    });
    return { status: "online", offline: false, message: healthMessage };
  } catch (error) {
    const healthMessage = error.message || "Media not found in storage";
    await updateVideoHealth(video._id, {
      healthStatus: "offline",
      healthMessage,
      healthCheckedAt: checkedAt,
    });
    return { status: "offline", offline: true, message: healthMessage };
  }
};

const runHealthMonitor = async ({ initiatedBy = "system" } = {}) => {
  const startedAt = Date.now();
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const servers = await StorageServer.find().sort({ isDefault: -1, name: 1 });
  const storageResults = [];

  for (const server of servers) {
    storageResults.push(await checkStorageServer(server));
  }

  const videos = await Video.find().select(
    "_id title videoId videoUrl sourceVideoKey hlsKeys qualityVariants processingStatus storageServer healthCheckedAt createdAt"
  );

  const serverMap = new Map();
  const offlineVideos = [];
  let onlineCount = 0;
  let offlineCount = 0;
  let processingCount = 0;
  let skippedCount = 0;
  let checkedLast24h = 0;

  for (const video of videos) {
    try {
      const result = await checkVideoHealth(video, serverMap);

      const isRecent =
        (video.createdAt && video.createdAt >= last24h) || (video.healthCheckedAt && video.healthCheckedAt >= last24h);
      if (isRecent) checkedLast24h += 1;

      if (result.status === "online") onlineCount += 1;
      else if (result.status === "offline") {
        offlineCount += 1;
        offlineVideos.push({
          videoId: video._id,
          shortId: video.videoId || "",
          title: video.title,
          status: "offline",
          message: result.message || "Media not found in storage",
          checkedAt: new Date(),
        });
      } else if (result.status === "processing") processingCount += 1;
      else skippedCount += 1;
    } catch (error) {
      skippedCount += 1;
      console.warn(`[HealthMonitor] Skipped video ${video._id}: ${error.message}`);
    }
  }

  const storageOnline = storageResults.filter((item) => item.status === "online").length;
  const storageOffline = storageResults.filter((item) => item.status === "offline").length;
  const intervalMs = getIntervalMs();
  const nextRunAt = new Date(Date.now() + intervalMs);

  const snapshot = await HealthMonitorSnapshot.findOneAndUpdate(
    { key: SNAPSHOT_KEY },
    {
      $set: {
        lastRunAt: now,
        nextRunAt,
        durationMs: Date.now() - startedAt,
        storageSummary: {
          total: storageResults.length,
          online: storageOnline,
          offline: storageOffline,
        },
        videoSummary: {
          total: videos.length,
          online: onlineCount,
          offline: offlineCount,
          processing: processingCount,
          skipped: skippedCount,
          checkedLast24h,
        },
        storageServers: storageResults,
        offlineVideos: offlineVideos.slice(0, 100),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );

  return {
    initiatedBy,
    snapshot: snapshot.toObject(),
  };
};

let schedulerStarted = false;

const startHealthMonitorScheduler = () => {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const enabled = ["1", "true", "yes", "on"].includes(String(process.env.HEALTH_CHECK_ENABLED || "true").toLowerCase());
  if (!enabled) return;

  const intervalMs = getIntervalMs();

  const run = async () => {
    try {
      await runHealthMonitor({ initiatedBy: "auto-scheduler" });
    } catch (error) {
      console.error("[HealthMonitor] Scheduled check failed:", error.message);
    }
  };

  setTimeout(run, 30_000);
  setInterval(run, intervalMs);
};

module.exports = {
  runHealthMonitor,
  startHealthMonitorScheduler,
  getIntervalMs,
};
