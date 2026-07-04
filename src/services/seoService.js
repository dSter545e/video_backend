const fs = require("fs");
const SiteSettings = require("../models/SiteSettings");
const { uploadFileToR2, deleteFileFromR2 } = require("../utils/r2Client");

const SETTINGS_KEY = "global";

const DEFAULT_SEO = {
  siteName: "xHub4u",
  defaultTitle: "",
  defaultDescription: "",
  defaultKeywords: "",
  defaultOgImage: "",
  defaultOgImageKey: "",
};

const normalizeSeo = (seo = {}) => ({
  siteName: (seo.siteName || DEFAULT_SEO.siteName).trim().slice(0, 80) || DEFAULT_SEO.siteName,
  defaultTitle: (seo.defaultTitle || "").trim().slice(0, 70),
  defaultDescription: (seo.defaultDescription || "").trim().slice(0, 160),
  defaultKeywords: (seo.defaultKeywords || "").trim().slice(0, 255),
  defaultOgImage: seo.defaultOgImage || "",
  defaultOgImageKey: seo.defaultOgImageKey || "",
});

const getOrCreateSiteSettings = async () => {
  let doc = await SiteSettings.findOne({ key: SETTINGS_KEY });
  if (!doc) {
    doc = await SiteSettings.create({ key: SETTINGS_KEY });
  }
  return doc;
};

const getSeoSettings = async () => {
  const doc = await SiteSettings.findOne({ key: SETTINGS_KEY }).lean();
  return normalizeSeo(doc?.seo || {});
};

const updateSeoSettings = async (payload = {}) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeSeo(doc.seo || {});

  if (typeof payload.siteName === "string") {
    current.siteName = payload.siteName.trim().slice(0, 80) || DEFAULT_SEO.siteName;
  }
  if (typeof payload.defaultTitle === "string") {
    current.defaultTitle = payload.defaultTitle.trim().slice(0, 70);
  }
  if (typeof payload.defaultDescription === "string") {
    current.defaultDescription = payload.defaultDescription.trim().slice(0, 160);
  }
  if (typeof payload.defaultKeywords === "string") {
    current.defaultKeywords = payload.defaultKeywords.trim().slice(0, 255);
  }
  if (typeof payload.defaultOgImage === "string") {
    current.defaultOgImage = payload.defaultOgImage.trim();
  }

  doc.seo = current;
  await doc.save();
  return normalizeSeo(doc.seo);
};

const setSeoDefaultOgImage = async ({ defaultOgImage, defaultOgImageKey }) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeSeo(doc.seo || {});
  current.defaultOgImage = defaultOgImage || "";
  current.defaultOgImageKey = defaultOgImageKey || "";
  doc.seo = current;
  await doc.save();
  return normalizeSeo(doc.seo);
};

module.exports = {
  getSeoSettings,
  updateSeoSettings,
  setSeoDefaultOgImage,
  normalizeSeo,
  DEFAULT_SEO,
};
