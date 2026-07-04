const fs = require("fs");
const mongoose = require("mongoose");
const Page = require("../models/Page");
const { uploadFileToR2, deleteFileFromR2, extractObjectKeyFromUrl } = require("../utils/r2Client");
const { buildUniqueSlug } = require("../utils/slug");
const { buildSeoDocument, buildSeoUpdateFields, applyUploadedOgImage } = require("../utils/seo");
const { ensureSystemPages } = require("../services/systemPagesService");

const uploadOgImageIfPresent = async (file) => {
  if (!file) return null;
  const objectKey = `images/seo/${Date.now()}-${file.filename}`;
  return uploadFileToR2({
    localFilePath: file.path,
    objectKey,
    contentType: file.mimetype || "image/jpeg",
  });
};

const resolvePagePath = (slug, pathValue) => {
  const trimmedPath = String(pathValue || "").trim();
  if (trimmedPath) {
    return trimmedPath.startsWith("/") ? trimmedPath : `/${trimmedPath}`;
  }
  return `/${slug}`;
};

const getPublishedPages = async (_req, res) => {
  const pages = await Page.find({ status: "published" }).sort({ title: 1 }).lean();
  return res.json(pages);
};

const getPublishedPageBySlug = async (req, res) => {
  const { slug } = req.params;
  const page = await Page.findOne({
    status: "published",
    $or: [{ slug }, { systemKey: slug }],
  }).lean();
  if (!page) {
    return res.status(404).json({ error: "Page not found" });
  }
  return res.json(page);
};

const syncSystemPages = async (_req, res) => {
  const pages = await ensureSystemPages();
  return res.json({ ok: true, count: pages.length });
};

const getPagesAdmin = async (_req, res) => {
  await ensureSystemPages();
  const pages = await Page.find().sort({ isSystem: -1, path: 1, title: 1 });
  return res.json(pages);
};

const getPageByIdAdmin = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid page id" });
  }
  const page = await Page.findById(id);
  if (!page) {
    return res.status(404).json({ error: "Page not found" });
  }
  return res.json(page);
};

const createPage = async (req, res) => {
  const { title, slug, path, content, status } = req.body;
  const ogImageFile = req.file || req.files?.ogImageFile?.[0];

  if (!title) {
    return res.status(400).json({ error: "title is required" });
  }

  try {
    const pageSlug = await buildUniqueSlug({
      source: title,
      providedSlug: slug,
      exists: async (candidate) => Boolean(await Page.exists({ slug: candidate })),
    });
    const uploadedOg = await uploadOgImageIfPresent(ogImageFile);
    const seo = buildSeoDocument(req.body);
    if (uploadedOg?.url) {
      seo.ogImage = uploadedOg.url;
      seo.ogImageKey = uploadedOg.key || "";
    }

    const page = await Page.create({
      title: title.trim(),
      slug: pageSlug,
      path: resolvePagePath(pageSlug, path),
      content: content || "",
      status: status === "published" ? "published" : "draft",
      seo,
    });
    return res.status(201).json(page);
  } catch (error) {
    return res.status(400).json({ error: "Page already exists or invalid data" });
  } finally {
    if (ogImageFile?.path) {
      fs.rmSync(ogImageFile.path, { force: true });
    }
  }
};

const updatePage = async (req, res) => {
  const { id } = req.params;
  const { title, slug, path, content, status } = req.body;
  const ogImageFile = req.file || req.files?.ogImageFile?.[0];

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid page id" });
  }

  try {
    const existing = await Page.findById(id);
    if (!existing) {
      return res.status(404).json({ error: "Page not found" });
    }

    const nextTitle = (title || existing.title || "").trim();
    const isSystemPage = Boolean(existing.isSystem);
    const shouldRegenerateSlug =
      !isSystemPage && (slug !== undefined || (title !== undefined && nextTitle !== existing.title));
    const nextSlug = shouldRegenerateSlug
      ? await buildUniqueSlug({
          source: nextTitle,
          providedSlug: slug,
          exists: async (candidate) => Boolean(await Page.exists({ slug: candidate, _id: { $ne: existing._id } })),
        })
      : existing.slug;

    const uploadedOg = await uploadOgImageIfPresent(ogImageFile);
    const existingOgKey = existing.seo?.ogImageKey || extractObjectKeyFromUrl(existing.seo?.ogImage);
    if (uploadedOg?.key && existingOgKey) {
      try {
        await deleteFileFromR2(existingOgKey);
      } catch (_error) {
        // ignore cleanup failure
      }
    }

    const updateDoc = {
      ...(title ? { title: nextTitle } : {}),
      ...(!isSystemPage && nextSlug ? { slug: nextSlug } : {}),
      ...(!isSystemPage && path !== undefined ? { path: resolvePagePath(nextSlug || existing.slug, path) } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(status !== undefined ? { status: status === "published" ? "published" : "draft" } : {}),
      ...buildSeoUpdateFields(req.body),
    };
    applyUploadedOgImage(updateDoc, uploadedOg, existing.seo);

    const page = await Page.findByIdAndUpdate(
      id,
      { $set: updateDoc },
      { returnDocument: "after", runValidators: true }
    );
    return res.json(page);
  } finally {
    if (ogImageFile?.path) {
      fs.rmSync(ogImageFile.path, { force: true });
    }
  }
};

const deletePage = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid page id" });
  }

  const deleted = await Page.findById(id);
  if (!deleted) {
    return res.status(404).json({ error: "Page not found" });
  }
  if (deleted.isSystem) {
    return res.status(400).json({ error: "System pages cannot be deleted" });
  }

  await Page.findByIdAndDelete(id);

  const ogKey = deleted.seo?.ogImageKey || extractObjectKeyFromUrl(deleted.seo?.ogImage);
  if (ogKey) {
    try {
      await deleteFileFromR2(ogKey);
    } catch (_error) {
      // ignore cleanup failure
    }
  }

  return res.status(204).send();
};

module.exports = {
  getPublishedPages,
  getPublishedPageBySlug,
  syncSystemPages,
  getPagesAdmin,
  getPageByIdAdmin,
  createPage,
  updatePage,
  deletePage,
};
