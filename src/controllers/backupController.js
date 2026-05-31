const {
  runBackupJob,
  listDatabaseBackups,
  getBackupStatus,
  restoreDatabaseBackup,
} = require("../services/backupService");

const createBackup = async (req, res) => {
  const initiatedBy = req.admin?.email || "admin";
  const result = await runBackupJob({ initiatedBy });
  return res.status(201).json(result);
};

const listBackups = async (_req, res) => {
  const [items, status] = await Promise.all([listDatabaseBackups(), getBackupStatus()]);
  return res.json({ items, status });
};

const restoreBackup = async (req, res) => {
  const { backupKey } = req.body || {};
  if (!backupKey) {
    return res.status(400).json({ error: "backupKey is required" });
  }
  const result = await restoreDatabaseBackup({ backupKey });
  return res.json(result);
};

module.exports = {
  createBackup,
  listBackups,
  restoreBackup,
};
