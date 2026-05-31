const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const {
  getStorageServers,
  getActiveStorageServers,
  createStorageServer,
  updateStorageServer,
  deleteStorageServer,
  testStorageServerConnection,
} = require("../controllers/storageServerController");

const router = express.Router();

router.get("/", adminAuth, getStorageServers);
router.get("/active", adminAuth, getActiveStorageServers);
router.post("/test", adminAuth, testStorageServerConnection);
router.post("/", adminAuth, createStorageServer);
router.put("/:id", adminAuth, updateStorageServer);
router.delete("/:id", adminAuth, deleteStorageServer);

module.exports = router;