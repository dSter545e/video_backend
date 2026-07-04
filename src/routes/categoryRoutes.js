const express = require("express");
const {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} = require("../controllers/categoryController");
const { adminAuth } = require("../middleware/authMiddleware");
const { uploadImageFile } = require("../middleware/uploadMiddleware");

const router = express.Router();
const categoryUploadFields = uploadImageFile.fields([
  { name: "image", maxCount: 1 },
  { name: "ogImageFile", maxCount: 1 },
]);

router.get("/", getCategories);
router.post("/", adminAuth, categoryUploadFields, createCategory);
router.put("/:id", adminAuth, categoryUploadFields, updateCategory);
router.delete("/:id", adminAuth, deleteCategory);

module.exports = router;
