const fs = require("fs");
const os = require("os");
const path = require("path");
const mongoose = require("mongoose");
const { EJSON } = require("bson");
const BackupSnapshot = require("../models/BackupSnapshot");
const { uploadFileToR2, listFilesFromR2, deleteFileFromR2, downloadFileFromR2 } = require("../utils/r2Client");

const BACKUP_PREFIX = "backups/mongodb";
const RETENTION_DAYS = 30;
const SNAPSHOT_KEY = "latest";
const DEFAULT_INTERVAL_HOURS = 24;

const getIntervalMs = () => {
  const hours = Number.parseInt(String(process.env.BACKUP_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS), 10);
  return Math.max(1, Number.isFinite(hours) ? hours : DEFAULT_INTERVAL_HOURS) * 60 * 60 * 1000;
};

const isAutoBackupEnabled = () =>
  ["1", "true", "yes", "on"].includes(String(process.env.BACKUP_AUTO_ENABLED || "true").toLowerCase());

const recordBackupRun = async ({ initiatedBy, status, startedAt, error = "", backupKey = "" }) => {
  const now = startedAt || new Date();
  const nextRunAt = new Date(now.getTime() + getIntervalMs());

  await BackupSnapshot.findOneAndUpdate(
    { key: SNAPSHOT_KEY },
    {
      $setOnInsert: { firstRunAt: now },
      $set: {
        lastRunAt: now,
        nextRunAt,
        lastInitiatedBy: initiatedBy,
        lastStatus: status,
        lastError: status === "failure" ? error : "",
        ...(status === "success" ? { lastSuccessAt: now, lastBackupKey: backupKey } : {}),
      },
      $inc: { totalRuns: 1 },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
};

const sanitizeTimestamp = (date = new Date()) => date.toISOString().replace(/[:.]/g, "-");

const createDatabaseBackup = async ({ initiatedBy = "system" } = {}) => {
  const db = mongoose.connection?.db;
  if (!db) throw new Error("MongoDB connection is not ready");

  const stamp = sanitizeTimestamp();
  const fileName = `mongo-backup-${stamp}.json`;
  const tempFilePath = path.join(os.tmpdir(), fileName);
  const objectKey = `${BACKUP_PREFIX}/${fileName}`;

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const backupPayload = {
    version: 1,
    createdAt: new Date().toISOString(),
    dbName: db.databaseName,
    collections: {},
  };

  for (const entry of collections) {
    const collectionName = entry.name;
    if (collectionName.startsWith("system.")) continue;
    const docs = await db.collection(collectionName).find({}).toArray();
    backupPayload.collections[collectionName] = docs;
  }

  fs.writeFileSync(tempFilePath, EJSON.stringify(backupPayload));
  const uploaded = await uploadFileToR2({
    localFilePath: tempFilePath,
    objectKey,
    contentType: "application/json",
  });
  const stat = fs.statSync(tempFilePath);
  fs.rmSync(tempFilePath, { force: true });

  return {
    key: objectKey,
    url: uploaded.url,
    size: stat.size,
    initiatedBy,
    createdAt: new Date().toISOString(),
  };
};

const listDatabaseBackups = async () => {
  const files = await listFilesFromR2(BACKUP_PREFIX);
  return files
    .sort((a, b) => (b.lastModified?.getTime() || 0) - (a.lastModified?.getTime() || 0))
    .map((item) => ({
      key: item.key,
      size: item.size,
      lastModified: item.lastModified ? item.lastModified.toISOString() : null,
    }));
};

const getBackupStatus = async () => {
  const snapshot = await BackupSnapshot.findOne({ key: SNAPSHOT_KEY });
  const items = await listDatabaseBackups();
  const fileTimes = items
    .map((item) => (item.lastModified ? new Date(item.lastModified).getTime() : 0))
    .filter((value) => value > 0);

  const firstBackupFileAt = fileTimes.length ? new Date(Math.min(...fileTimes)).toISOString() : null;
  const lastBackupFileAt = fileTimes.length ? new Date(Math.max(...fileTimes)).toISOString() : null;
  const intervalHours = Math.round(getIntervalMs() / (60 * 60 * 1000));

  return {
    firstRunAt: snapshot?.firstRunAt?.toISOString() || firstBackupFileAt,
    lastRunAt: snapshot?.lastRunAt?.toISOString() || lastBackupFileAt,
    lastSuccessAt: snapshot?.lastSuccessAt?.toISOString() || null,
    nextRunAt: snapshot?.nextRunAt?.toISOString() || null,
    lastInitiatedBy: snapshot?.lastInitiatedBy || "",
    lastStatus: snapshot?.lastStatus || "unknown",
    lastError: snapshot?.lastError || "",
    lastBackupKey: snapshot?.lastBackupKey || "",
    totalRuns: snapshot?.totalRuns || 0,
    totalBackupFiles: items.length,
    firstBackupFileAt,
    lastBackupFileAt,
    autoBackupEnabled: isAutoBackupEnabled(),
    intervalHours,
  };
};

const runBackupJob = async ({ initiatedBy = "system" } = {}) => {
  const startedAt = new Date();
  try {
    const result = await createDatabaseBackup({ initiatedBy });
    await pruneOldBackups({ retentionDays: RETENTION_DAYS });
    await recordBackupRun({
      initiatedBy,
      status: "success",
      startedAt,
      backupKey: result.key,
    });
    return result;
  } catch (error) {
    await recordBackupRun({
      initiatedBy,
      status: "failure",
      startedAt,
      error: error.message || "Backup failed",
    });
    throw error;
  }
};

const pruneOldBackups = async ({ retentionDays = RETENTION_DAYS } = {}) => {
  const files = await listFilesFromR2(BACKUP_PREFIX);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const toDelete = files.filter((file) => (file.lastModified ? file.lastModified.getTime() < cutoff : false));
  for (const file of toDelete) {
    await deleteFileFromR2(file.key);
  }
  return { deletedCount: toDelete.length };
};

const restoreDatabaseBackup = async ({ backupKey }) => {
  if (!backupKey) throw new Error("backupKey is required");
  const db = mongoose.connection?.db;
  if (!db) throw new Error("MongoDB connection is not ready");

  const fileName = path.basename(backupKey);
  const tempFilePath = path.join(os.tmpdir(), `restore-${Date.now()}-${fileName}`);
  const buffer = await downloadFileFromR2(backupKey);
  fs.writeFileSync(tempFilePath, buffer);

  const parsed = EJSON.parse(fs.readFileSync(tempFilePath, "utf-8"));
  const collections = parsed?.collections || {};

  for (const [collectionName, docs] of Object.entries(collections)) {
    if (collectionName.startsWith("system.")) continue;
    const collection = db.collection(collectionName);
    await collection.deleteMany({});
    if (Array.isArray(docs) && docs.length) {
      await collection.insertMany(docs, { ordered: false });
    }
  }
  fs.rmSync(tempFilePath, { force: true });
  return { restoredFrom: backupKey, restoredAt: new Date().toISOString() };
};

const startAutoBackupScheduler = () => {
  if (!isAutoBackupEnabled()) return;
  const intervalMs = getIntervalMs();

  const run = async () => {
    try {
      await runBackupJob({ initiatedBy: "auto-scheduler" });
      console.log("[Backup] Auto backup completed");
    } catch (error) {
      console.error("[Backup] Auto backup failed:", error.message);
    }
  };

  setTimeout(run, 15_000);
  setInterval(run, intervalMs);
};

module.exports = {
  createDatabaseBackup,
  listDatabaseBackups,
  getBackupStatus,
  runBackupJob,
  pruneOldBackups,
  restoreDatabaseBackup,
  startAutoBackupScheduler,
  getIntervalMs,
};
