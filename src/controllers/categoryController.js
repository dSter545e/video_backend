const fs = require("fs");
const Category = require("../models/Category");
const mongoose = require("mongoose");
const Video = require("../models/Video");
const { uploadFileToR2, deleteFileFromR2, extractObjectKeyFromUrl } = require("../utils/r2Client");
const { buildUniqueSlug } = require("../utils/slug");

const categoryDebugLog = () => {};
const FEATURED_CATEGORY_LIMIT = 6;

const parseFeaturedFlag = (featuredValue) => {
  if (featuredValue === undefined) return undefined;
  if (typeof featuredValue === "boolean") return featuredValue;
  if (typeof featuredValue === "string") {
    const normalized = featuredValue.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
  }
  return Boolean(featuredValue);
};

const uploadCategoryImageIfPresent = async (file) => {
  if (!file) return null;
  categoryDebugLog("Uploading category image to R2", { originalName: file.originalname, mimeType: file.mimetype });
  const objectKey = `images/categories/${Date.now()}-${file.filename}`;
  const uploaded = await uploadFileToR2({
    localFilePath: file.path,
    objectKey,
    contentType: file.mimetype || "image/jpeg",
  });
  return uploaded;
};

const getCategories = async (_req, res) => {
  categoryDebugLog("Fetching all categories");
  const categories = await Category.find().sort({ createdAt: -1 });
  categoryDebugLog("Categories fetched", { count: categories.length });
  return res.json(categories);
};

const createCategory = async (req, res) => {
  const { name, imageUrl, slug } = req.body;
  const featured = parseFeaturedFlag(req.body.featured);
  const imageFile = req.file;
  categoryDebugLog("Create category request", {
    name,
    hasImageUrl: Boolean(imageUrl),
    hasImageFile: Boolean(imageFile),
  });
  if (!name) {
    categoryDebugLog("Create category failed: name is missing");
    return res.status(400).json({ error: "name is required" });
  }

  try {
    if (featured) {
      const featuredCount = await Category.countDocuments({ featured: true });
      if (featuredCount >= FEATURED_CATEGORY_LIMIT) {
        return res.status(400).json({ error: "Maximum 6 featured categories allowed" });
      }
    }

    const uploadedImage = await uploadCategoryImageIfPresent(imageFile);
    const categorySlug = await buildUniqueSlug({
      source: name,
      providedSlug: slug,
      exists: async (candidate) => Boolean(await Category.exists({ slug: candidate })),
    });
    const category = await Category.create({
      name,
      slug: categorySlug,
      imageUrl: uploadedImage?.url || imageUrl || "",
      imageKey: uploadedImage?.key || "",
      featured: Boolean(featured),
    });
    categoryDebugLog("Create category success", { categoryId: category._id.toString() });
    return res.status(201).json(category);
  } catch (error) {
    categoryDebugLog("Create category failed", { error: error.message });
    return res.status(400).json({ error: "Category already exists or invalid data" });
  } finally {
    if (imageFile?.path) {
      fs.rmSync(imageFile.path, { force: true });
    }
  }
};

const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, imageUrl, slug } = req.body;
  const featured = parseFeaturedFlag(req.body.featured);
  const imageFile = req.file;
  categoryDebugLog("Update category request", {
    id,
    hasName: Boolean(name),
    hasImageUrl: imageUrl !== undefined,
    hasImageFile: Boolean(imageFile),
  });

  if (!mongoose.Types.ObjectId.isValid(id)) {
    categoryDebugLog("Update category failed: invalid id", { id });
    return res.status(400).json({ error: "Invalid category id" });
  }

  try {
    const existing = await Category.findById(id);
    if (!existing) {
      categoryDebugLog("Update category failed: category not found", { id });
      return res.status(404).json({ error: "Category not found" });
    }

    const shouldFeatureCategory = featured === undefined ? existing.featured : featured;
    if (shouldFeatureCategory && !existing.featured) {
      const featuredCount = await Category.countDocuments({ featured: true, _id: { $ne: existing._id } });
      if (featuredCount >= FEATURED_CATEGORY_LIMIT) {
        return res.status(400).json({ error: "Maximum 6 featured categories allowed" });
      }
    }

    const uploadedImage = await uploadCategoryImageIfPresent(imageFile);
    const existingImageKey = existing.imageKey || extractObjectKeyFromUrl(existing.imageUrl);
    if (uploadedImage?.key && existingImageKey) {
      try {
        await deleteFileFromR2(existingImageKey);
      } catch (error) {
        categoryDebugLog("Failed deleting old category image from R2", { id, error: error.message });
      }
    }

    const nextCategoryName = (name || existing.name || "").trim();
    const shouldRegenerateSlug = slug !== undefined || (name !== undefined && nextCategoryName !== existing.name);
    const nextSlug = shouldRegenerateSlug
      ? await buildUniqueSlug({
          source: nextCategoryName,
          providedSlug: slug,
          exists: async (candidate) =>
            Boolean(await Category.exists({ slug: candidate, _id: { $ne: existing._id } })),
        })
      : existing.slug;

    const category = await Category.findByIdAndUpdate(
      id,
      {
        $set: {
          ...(name ? { name } : {}),
          ...(nextSlug ? { slug: nextSlug } : {}),
          ...(imageUrl !== undefined ? { imageUrl } : {}),
          ...(uploadedImage?.url ? { imageUrl: uploadedImage.url } : {}),
          ...(uploadedImage?.key ? { imageKey: uploadedImage.key } : {}),
          ...(featured !== undefined ? { featured } : {}),
        },
      },
      { returnDocument: "after", runValidators: true }
    );

    if (!category) {
      categoryDebugLog("Update category failed: category not found", { id });
      return res.status(404).json({ error: "Category not found" });
    }

    categoryDebugLog("Update category success", { id });
    return res.json(category);
  } finally {
    if (imageFile?.path) {
      fs.rmSync(imageFile.path, { force: true });
    }
  }
};

const deleteCategory = async (req, res) => {
  const { id } = req.params;
  categoryDebugLog("Delete category request", { id });

  if (!mongoose.Types.ObjectId.isValid(id)) {
    categoryDebugLog("Delete category failed: invalid id", { id });
    return res.status(400).json({ error: "Invalid category id" });
  }

  const usedInVideo = await Video.exists({ category: id });
  if (usedInVideo) {
    categoryDebugLog("Delete category blocked: linked videos found", { id });
    return res.status(400).json({ error: "Cannot delete category linked with videos" });
  }

  const deleted = await Category.findByIdAndDelete(id);
  if (!deleted) {
    categoryDebugLog("Delete category failed: category not found", { id });
    return res.status(404).json({ error: "Category not found" });
  }

  const deletedImageKey = deleted.imageKey || extractObjectKeyFromUrl(deleted.imageUrl);
  if (deletedImageKey) {
    try {
      await deleteFileFromR2(deletedImageKey);
    } catch (error) {
      categoryDebugLog("Failed deleting category image from R2", { id, error: error.message });
    }
  }

  categoryDebugLog("Delete category success", { id });
  return res.status(204).send();
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
