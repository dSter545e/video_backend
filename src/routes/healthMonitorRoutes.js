const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const { getHealthMonitorStatus, triggerHealthMonitor } = require("../controllers/healthMonitorController");

const router = express.Router();

router.get("/", adminAuth, getHealthMonitorStatus);
router.post("/run", adminAuth, triggerHealthMonitor);

module.exports = router;
