const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const { uploadImageFile } = require("../middleware/uploadMiddleware");
const {
  getWatermark,
  updateWatermark,
  uploadWatermarkLogo,
  removeWatermarkLogo,
  getSeo,
  updateSeo,
  uploadSeoDefaultOgImage,
  removeSeoDefaultOgImage,
  getSite,
  updateSite,
  uploadSiteLogo,
  removeSiteLogo,
  uploadSiteFavicon,
  removeSiteFavicon,
  getPublicSettings,
} = require("../controllers/settingsController");

const router = express.Router();

router.get("/public", getPublicSettings);

router.get("/watermark", adminAuth, getWatermark);
router.put("/watermark", adminAuth, updateWatermark);
router.post("/watermark/logo", adminAuth, uploadImageFile.single("logo"), uploadWatermarkLogo);
router.delete("/watermark/logo", adminAuth, removeWatermarkLogo);

router.get("/site", getSite);
router.get("/site/admin", adminAuth, getSite);
router.put("/site", adminAuth, updateSite);
router.post("/site/logo", adminAuth, uploadImageFile.single("logo"), uploadSiteLogo);
router.delete("/site/logo", adminAuth, removeSiteLogo);
router.post("/site/favicon", adminAuth, uploadImageFile.single("favicon"), uploadSiteFavicon);
router.delete("/site/favicon", adminAuth, removeSiteFavicon);

router.get("/seo", getSeo);
router.get("/seo/admin", adminAuth, getSeo);
router.put("/seo", adminAuth, updateSeo);
router.post("/seo/og-image", adminAuth, uploadImageFile.single("ogImage"), uploadSeoDefaultOgImage);
router.delete("/seo/og-image", adminAuth, removeSeoDefaultOgImage);

module.exports = router;
