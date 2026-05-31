const HealthMonitorSnapshot = require("../models/HealthMonitorSnapshot");
const { runHealthMonitor } = require("../services/healthMonitorService");

const SNAPSHOT_KEY = "latest";

const getHealthMonitorStatus = async (_req, res) => {
  const snapshot = await HealthMonitorSnapshot.findOne({ key: SNAPSHOT_KEY }).lean();
  if (!snapshot) {
    return res.json({
      lastRunAt: null,
      nextRunAt: null,
      storageSummary: { total: 0, online: 0, offline: 0 },
      videoSummary: { total: 0, online: 0, offline: 0, processing: 0, skipped: 0, checkedLast24h: 0 },
      storageServers: [],
      offlineVideos: [],
    });
  }
  return res.json(snapshot);
};

const triggerHealthMonitor = async (_req, res) => {
  try {
    const result = await runHealthMonitor({ initiatedBy: "admin" });
    return res.json(result.snapshot);
  } catch (error) {
    return res.status(500).json({ error: error.message || "Health check failed" });
  }
};

module.exports = {
  getHealthMonitorStatus,
  triggerHealthMonitor,
};
