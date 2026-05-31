const express = require("express");
const { signupUser, loginUser, forgotPassword, resetPassword, getCurrentUser } = require("../controllers/userAuthController");
const { userAuth } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/signup", signupUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", userAuth, resetPassword);
router.get("/me", userAuth, getCurrentUser);

module.exports = router;
