const express = require("express");
const { getUsersAdmin } = require("../controllers/userController");
const { adminAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/admin/all", adminAuth, getUsersAdmin);

module.exports = router;
