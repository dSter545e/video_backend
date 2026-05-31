const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const { createBackup, listBackups, restoreBackup } = require("../controllers/backupController");

const router = express.Router();

router.get("/", adminAuth, listBackups);
router.post("/create", adminAuth, createBackup);
router.post("/restore", adminAuth, restoreBackup);

module.exports = router;
