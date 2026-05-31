const {
  createDatabaseBackup,
  listDatabaseBackups,
  pruneOldBackups,
  restoreDatabaseBackup,
} = require("../services/backupService");

const createBackup = async (req, res) => {
  const initiatedBy = req.admin?.email || "admin";
  const result = await createDatabaseBackup({ initiatedBy });
  await pruneOldBackups({ retentionDays: 30 });
  return res.status(201).json(result);
};

const listBackups = async (_req, res) => {
  const backups = await listDatabaseBackups();
  return res.json(backups);
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
