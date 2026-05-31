const express = require("express");
const { loginAdmin, getCurrentAdmin } = require("../controllers/authController");
const { adminAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/login", loginAdmin);
router.get("/me", adminAuth, getCurrentAdmin);

module.exports = router;
