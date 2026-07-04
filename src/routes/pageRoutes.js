const express = require("express");
const {
  getPublishedPages,
  getPublishedPageBySlug,
  syncSystemPages,
  getPagesAdmin,
  getPageByIdAdmin,
  createPage,
  updatePage,
  deletePage,
} = require("../controllers/pageController");
const { adminAuth } = require("../middleware/authMiddleware");
const { uploadImageFile } = require("../middleware/uploadMiddleware");

const router = express.Router();
const pageUploadFields = uploadImageFile.fields([{ name: "ogImageFile", maxCount: 1 }]);

router.get("/public", getPublishedPages);
router.get("/public/:slug", getPublishedPageBySlug);
router.post("/admin/sync-system", adminAuth, syncSystemPages);
router.get("/admin/all", adminAuth, getPagesAdmin);
router.get("/admin/:id", adminAuth, getPageByIdAdmin);
router.post("/", adminAuth, pageUploadFields, createPage);
router.put("/:id", adminAuth, pageUploadFields, updatePage);
router.delete("/:id", adminAuth, deletePage);

module.exports = router;
