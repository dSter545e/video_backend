const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const { uploadImageFile } = require("../middleware/uploadMiddleware");
const {
  getWatermark,
  updateWatermark,
  uploadWatermarkLogo,
  removeWatermarkLogo,
} = require("../controllers/settingsController");

const router = express.Router();

router.get("/watermark", adminAuth, getWatermark);
router.put("/watermark", adminAuth, updateWatermark);
router.post("/watermark/logo", adminAuth, uploadImageFile.single("logo"), uploadWatermarkLogo);
router.delete("/watermark/logo", adminAuth, removeWatermarkLogo);

module.exports = router;
