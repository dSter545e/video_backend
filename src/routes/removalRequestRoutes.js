const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const {
  createRemovalRequest,
  listRemovalRequestsAdmin,
  updateRemovalRequestAdmin,
  deleteRemovalRequestAdmin,
} = require("../controllers/removalRequestController");

const router = express.Router();

router.post("/", createRemovalRequest);
router.get("/admin/all", adminAuth, listRemovalRequestsAdmin);
router.patch("/admin/:id", adminAuth, updateRemovalRequestAdmin);
router.delete("/admin/:id", adminAuth, deleteRemovalRequestAdmin);

module.exports = router;
