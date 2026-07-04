const fs = require("fs");
const Category = require("../models/Category");
const mongoose = require("mongoose");
const Video = require("../models/Video");
const { uploadFileToR2, deleteFileFromR2, extractObjectKeyFromUrl } = require("../utils/r2Client");
const { buildUniqueSlug } = require("../utils/slug");
const { buildSeoDocument, buildSeoUpdateFields, applyUploadedOgImage } = require("../utils/seo");

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
  const objectKey = `images/categories/${Date.now()}-${file.filename}`;
  const uploaded = await uploadFileToR2({
    localFilePath: file.path,
    objectKey,
    contentType: file.mimetype || "image/jpeg",
  });
  return uploaded;
};

const uploadCategoryOgImageIfPresent = async (file) => {
  if (!file) return null;
  const objectKey = `images/seo/${Date.now()}-${file.filename}`;
  return uploadFileToR2({
    localFilePath: file.path,
    objectKey,
    contentType: file.mimetype || "image/jpeg",
  });
};

const getCategories = async (_req, res) => {
  const categories = await Category.find().sort({ createdAt: -1 });
  return res.json(categories);
};

const createCategory = async (req, res) => {
  const { name, imageUrl, slug } = req.body;
  const featured = parseFeaturedFlag(req.body.featured);
  const imageFile = req.file || req.files?.image?.[0];
  const ogImageFile = req.files?.ogImageFile?.[0];
  if (!name) {
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
    const uploadedOg = await uploadCategoryOgImageIfPresent(ogImageFile);
    const seo = buildSeoDocument(req.body);
    if (uploadedOg?.url) {
      seo.ogImage = uploadedOg.url;
      seo.ogImageKey = uploadedOg.key || "";
    }
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
      seo,
    });
    return res.status(201).json(category);
  } catch (error) {
    return res.status(400).json({ error: "Category already exists or invalid data" });
  } finally {
    if (imageFile?.path) {
      fs.rmSync(imageFile.path, { force: true });
    }
    if (ogImageFile?.path) {
      fs.rmSync(ogImageFile.path, { force: true });
    }
  }
};

const updateCategory = async (req, res) => {
  const { id } = req.params;
  const { name, imageUrl, slug } = req.body;
  const featured = parseFeaturedFlag(req.body.featured);
  const imageFile = req.file || req.files?.image?.[0];
  const ogImageFile = req.files?.ogImageFile?.[0];

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid category id" });
  }

  try {
    const existing = await Category.findById(id);
    if (!existing) {
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
    const uploadedOg = await uploadCategoryOgImageIfPresent(ogImageFile);
    const existingImageKey = existing.imageKey || extractObjectKeyFromUrl(existing.imageUrl);
    if (uploadedImage?.key && existingImageKey) {
      try {
        await deleteFileFromR2(existingImageKey);
      } catch (error) {
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

    const existingOgKey = existing.seo?.ogImageKey || extractObjectKeyFromUrl(existing.seo?.ogImage);
    if (uploadedOg?.key && existingOgKey) {
      try {
        await deleteFileFromR2(existingOgKey);
      } catch (error) {
      }
    }

    const updateSet = {
      ...(name ? { name } : {}),
      ...(nextSlug ? { slug: nextSlug } : {}),
      ...(imageUrl !== undefined ? { imageUrl } : {}),
      ...(uploadedImage?.url ? { imageUrl: uploadedImage.url } : {}),
      ...(uploadedImage?.key ? { imageKey: uploadedImage.key } : {}),
      ...(featured !== undefined ? { featured } : {}),
      ...buildSeoUpdateFields(req.body),
    };
    applyUploadedOgImage(updateSet, uploadedOg, existing.seo);

    const category = await Category.findByIdAndUpdate(
      id,
      {
        $set: updateSet,
      },
      { returnDocument: "after", runValidators: true }
    );

    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }
    return res.json(category);
  } finally {
    if (imageFile?.path) {
      fs.rmSync(imageFile.path, { force: true });
    }
    if (ogImageFile?.path) {
      fs.rmSync(ogImageFile.path, { force: true });
    }
  }
};

const deleteCategory = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid category id" });
  }

  const usedInVideo = await Video.exists({ category: id });
  if (usedInVideo) {
    return res.status(400).json({ error: "Cannot delete category linked with videos" });
  }

  const deleted = await Category.findByIdAndDelete(id);
  if (!deleted) {
    return res.status(404).json({ error: "Category not found" });
  }

  const deletedImageKey = deleted.imageKey || extractObjectKeyFromUrl(deleted.imageUrl);
  if (deletedImageKey) {
    try {
      await deleteFileFromR2(deletedImageKey);
    } catch (error) {
    }
  }
  return res.status(204).send();
};

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
