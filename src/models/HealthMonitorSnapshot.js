const mongoose = require("mongoose");

const healthMonitorSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, default: "latest", unique: true },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    storageSummary: {
      total: { type: Number, default: 0 },
      online: { type: Number, default: 0 },
      offline: { type: Number, default: 0 },
    },
    videoSummary: {
      total: { type: Number, default: 0 },
      online: { type: Number, default: 0 },
      offline: { type: Number, default: 0 },
      processing: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      checkedLast24h: { type: Number, default: 0 },
    },
    storageServers: [
      {
        serverId: { type: mongoose.Schema.Types.ObjectId, ref: "StorageServer" },
        name: String,
        bucketName: String,
        status: { type: String, enum: ["online", "offline", "unknown"], default: "unknown" },
        message: { type: String, default: "" },
        checkedAt: Date,
      },
    ],
    offlineVideos: [
      {
        videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video" },
        shortId: String,
        title: String,
        status: String,
        message: String,
        checkedAt: Date,
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("HealthMonitorSnapshot", healthMonitorSnapshotSchema);
