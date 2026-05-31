const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const { getDashboardStats } = require("../controllers/dashboardController");

const router = express.Router();

router.get("/", adminAuth, getDashboardStats);

module.exports = router;
