const StorageServer = require("../models/StorageServer");
const mongoose = require("mongoose");
const { headBucketInR2, formatR2Error } = require("../utils/r2Client");

const getStorageServers = async (req, res) => {
  const servers = await StorageServer.find().sort({ createdAt: -1 });
  // Omit secret access key from response for security
  const safeServers = servers.map(server => {
    const s = server.toObject();
    s.secretAccessKey = "********";
    return s;
  });
  return res.json(safeServers);
};

const getActiveStorageServers = async (req, res) => {
  const servers = await StorageServer.find({ isActive: true }).sort({ name: 1 });
  const safeServers = servers.map(server => {
    const s = server.toObject();
    s.secretAccessKey = "********";
    return s;
  });
  return res.json(safeServers);
};

const createStorageServer = async (req, res) => {
  const { name, accountId, accessKeyId, secretAccessKey, bucketName, publicBaseUrl, isDefault, isActive } = req.body;

  if (!name || !accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return res.status(400).json({ error: "Required fields are missing" });
  }

  const serverCount = await StorageServer.countDocuments();

  const server = await StorageServer.create({
    name,
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicBaseUrl: publicBaseUrl || "",
    isDefault: serverCount === 0 ? true : Boolean(isDefault),
    isActive: isActive !== undefined ? Boolean(isActive) : true,
  });

  const safeServer = server.toObject();
  safeServer.secretAccessKey = "********";
  return res.status(201).json(safeServer);
};

const updateStorageServer = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

  const { name, accountId, accessKeyId, secretAccessKey, bucketName, publicBaseUrl, isDefault, isActive } = req.body;

  const updateData = {
    ...(name !== undefined && { name }),
    ...(accountId !== undefined && { accountId }),
    ...(accessKeyId !== undefined && { accessKeyId }),
    ...(secretAccessKey && secretAccessKey !== "********" && { secretAccessKey }),
    ...(bucketName !== undefined && { bucketName }),
    ...(publicBaseUrl !== undefined && { publicBaseUrl }),
    ...(isDefault !== undefined && { isDefault }),
    ...(isActive !== undefined && { isActive }),
  };

  const server = await StorageServer.findById(id);
  if (!server) return res.status(404).json({ error: "Storage server not found" });

  Object.assign(server, updateData);
  await server.save();

  const safeServer = server.toObject();
  safeServer.secretAccessKey = "********";
  return res.json(safeServer);
};

const deleteStorageServer = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

  const server = await StorageServer.findById(id);
  if (!server) return res.status(404).json({ error: "Storage server not found" });

  // Can't delete if it's the only one or used by videos (we'd need to check Video model)
  const Video = require("../models/Video");
  const inUse = await Video.exists({ storageServer: id });
  if (inUse) {
    return res.status(400).json({ error: "Cannot delete a storage server that is linked to videos" });
  }

  await StorageServer.findByIdAndDelete(id);

  if (server.isDefault) {
    const nextServer = await StorageServer.findOne().sort({ createdAt: -1 });
    if (nextServer) {
      nextServer.isDefault = true;
      await nextServer.save();
    }
  }

  return res.status(204).send();
};

const testStorageServerConnection = async (req, res) => {
  const { accountId, accessKeyId, secretAccessKey, bucketName } = req.body;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    return res.status(400).json({ error: "accountId, accessKeyId, secretAccessKey, and bucketName are required" });
  }

  if (secretAccessKey === "********") {
    return res.status(400).json({ error: "Enter the secret access key to test, or use Test on a saved server." });
  }

  try {
    await headBucketInR2({ accountId, accessKeyId, secretAccessKey, bucketName });
    return res.json({ success: true, message: "Connection successful" });
  } catch (error) {
    return res.status(400).json({ error: `Connection failed: ${error.message || formatR2Error(error)}` });
  }
};

const testStoredStorageServerConnection = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid id" });

  const server = await StorageServer.findById(id);
  if (!server) return res.status(404).json({ error: "Storage server not found" });

  try {
    await headBucketInR2(server.toObject());
    return res.json({ success: true, message: "Connection successful" });
  } catch (error) {
    return res.status(400).json({ error: `Connection failed: ${error.message || formatR2Error(error)}` });
  }
};

module.exports = {
  getStorageServers,
  getActiveStorageServers,
  createStorageServer,
  updateStorageServer,
  deleteStorageServer,
  testStorageServerConnection,
  testStoredStorageServerConnection,
};