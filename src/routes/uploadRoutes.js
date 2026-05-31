const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const { uploadImageFile } = require("../middleware/uploadMiddleware");
const { uploadImage } = require("../controllers/uploadController");

const router = express.Router();

router.post("/image", adminAuth, uploadImageFile.single("image"), uploadImage);

module.exports = router;
