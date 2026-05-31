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

router.get("/", getCategories);
router.post("/", adminAuth, uploadImageFile.single("image"), createCategory);
router.put("/:id", adminAuth, uploadImageFile.single("image"), updateCategory);
router.delete("/:id", adminAuth, deleteCategory);

module.exports = router;
