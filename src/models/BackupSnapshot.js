const mongoose = require("mongoose");

const backupSnapshotSchema = new mongoose.Schema(
  {
    key: { type: String, default: "latest", unique: true },
    firstRunAt: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    lastInitiatedBy: { type: String, default: "" },
    lastStatus: { type: String, enum: ["success", "failure", "unknown"], default: "unknown" },
    lastError: { type: String, default: "" },
    lastBackupKey: { type: String, default: "" },
    totalRuns: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("BackupSnapshot", backupSnapshotSchema);
