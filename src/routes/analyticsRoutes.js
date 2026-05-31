const express = require("express");
const { endSession, getAdminSummary, logEvent, startSession } = require("../controllers/analyticsController");
const { adminAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/session/start", startSession);
router.post("/event", logEvent);
router.post("/session/end", endSession);
router.get("/admin/summary", adminAuth, getAdminSummary);

module.exports = router;
