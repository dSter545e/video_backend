const fs = require("fs");
const {
  getWatermarkSettings,
  updateWatermarkSettings,
  setWatermarkLogo,
  normalizeWatermark,
} = require("../services/watermarkService");
const {
  getSeoSettings,
  updateSeoSettings,
  setSeoDefaultOgImage,
} = require("../services/seoService");
const {
  getSiteSettings,
  updateSiteSettings,
  setSiteLogo,
  setSiteFavicon,
} = require("../services/siteService");
const { uploadFileToR2, deleteFileFromR2 } = require("../utils/r2Client");

const getWatermark = async (_req, res) => {
  const watermark = await getWatermarkSettings();
  return res.json({ watermark });
};

const updateWatermark = async (req, res) => {
  const { enabled, mode, text, opacity, margin } = req.body || {};
  if (mode !== undefined && mode !== "text" && mode !== "logo") {
    return res.status(400).json({ error: "mode must be text or logo" });
  }

  const watermark = await updateWatermarkSettings({
    enabled,
    mode,
    text,
    opacity,
    margin,
  });
  return res.json({ watermark });
};

const uploadWatermarkLogo = async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "logo image is required" });
  }

  const previous = await getWatermarkSettings();
  const ext = (file.originalname || "").split(".").pop() || "png";
  const objectKey = `images/watermarks/logo-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, "") || "png"}`;

  try {
    const uploaded = await uploadFileToR2({
      localFilePath: file.path,
      objectKey,
      contentType: file.mimetype || "image/png",
    });

    const watermark = await setWatermarkLogo({
      logoUrl: uploaded.url,
      logoKey: uploaded.key,
    });

    if (previous.logoKey && previous.logoKey !== uploaded.key) {
      try {
        await deleteFileFromR2(previous.logoKey);
      } catch (_cleanupError) {
        // ignore cleanup failure
      }
    }

    return res.json({ watermark });
  } finally {
    if (file.path) {
      fs.rmSync(file.path, { force: true });
    }
  }
};

const removeWatermarkLogo = async (_req, res) => {
  const previous = normalizeWatermark((await getWatermarkSettings()) || {});
  const watermark = await setWatermarkLogo({ logoUrl: "", logoKey: "" });

  if (previous.logoKey) {
    try {
      await deleteFileFromR2(previous.logoKey);
    } catch (_cleanupError) {
      // ignore cleanup failure
    }
  }

  return res.json({ watermark });
};

const getSeo = async (_req, res) => {
  const seo = await getSeoSettings();
  return res.json({ seo });
};

const updateSeo = async (req, res) => {
  const { siteName, defaultTitle, defaultDescription, defaultKeywords, defaultOgImage } = req.body || {};
  const seo = await updateSeoSettings({
    siteName,
    defaultTitle,
    defaultDescription,
    defaultKeywords,
    defaultOgImage,
  });
  return res.json({ seo });
};

const uploadSeoDefaultOgImage = async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: "og image is required" });
  }

  const previous = await getSeoSettings();
  const ext = (file.originalname || "").split(".").pop() || "jpg";
  const objectKey = `images/seo/site-default-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, "") || "jpg"}`;

  try {
    const uploaded = await uploadFileToR2({
      localFilePath: file.path,
      objectKey,
      contentType: file.mimetype || "image/jpeg",
    });

    const seo = await setSeoDefaultOgImage({
      defaultOgImage: uploaded.url,
      defaultOgImageKey: uploaded.key,
    });

    if (previous.defaultOgImageKey && previous.defaultOgImageKey !== uploaded.key) {
      try {
        await deleteFileFromR2(previous.defaultOgImageKey);
      } catch (_cleanupError) {
        // ignore cleanup failure
      }
    }

    return res.json({ seo });
  } finally {
    if (file.path) {
      fs.rmSync(file.path, { force: true });
    }
  }
};

const removeSeoDefaultOgImage = async (_req, res) => {
  const previous = await getSeoSettings();
  const seo = await setSeoDefaultOgImage({ defaultOgImage: "", defaultOgImageKey: "" });

  if (previous.defaultOgImageKey) {
    try {
      await deleteFileFromR2(previous.defaultOgImageKey);
    } catch (_cleanupError) {
      // ignore cleanup failure
    }
  }

  return res.json({ seo });
};

const getSite = async (_req, res) => {
  const site = await getSiteSettings();
  return res.json({ site });
};

const updateSite = async (req, res) => {
  const { tagline, footerAbout, contactEmail, supportEmail } = req.body || {};
  const site = await updateSiteSettings({
    tagline,
    footerAbout,
    contactEmail,
    supportEmail,
  });
  return res.json({ site });
};

const uploadSiteAsset = async (req, res, { field, setFn, objectPrefix, defaultExt, defaultMime }) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: `${field} image is required` });
  }

  const previous = await getSiteSettings();
  const ext = (file.originalname || "").split(".").pop() || defaultExt;
  const objectKey = `images/site/${objectPrefix}-${Date.now()}.${ext.replace(/[^a-z0-9]/gi, "") || defaultExt}`;

  try {
    const uploaded = await uploadFileToR2({
      localFilePath: file.path,
      objectKey,
      contentType: file.mimetype || defaultMime,
    });

    const site = await setFn({
      [`${field}Url`]: uploaded.url,
      [`${field}Key`]: uploaded.key,
    });

    const previousKey = previous[`${field}Key`];
    if (previousKey && previousKey !== uploaded.key) {
      try {
        await deleteFileFromR2(previousKey);
      } catch (_cleanupError) {
        // ignore cleanup failure
      }
    }

    return res.json({ site });
  } finally {
    if (file.path) {
      fs.rmSync(file.path, { force: true });
    }
  }
};

const uploadSiteLogo = async (req, res) =>
  uploadSiteAsset(req, res, {
    field: "logo",
    setFn: setSiteLogo,
    objectPrefix: "logo",
    defaultExt: "png",
    defaultMime: "image/png",
  });

const removeSiteLogo = async (_req, res) => {
  const previous = await getSiteSettings();
  const site = await setSiteLogo({ logoUrl: "", logoKey: "" });

  if (previous.logoKey) {
    try {
      await deleteFileFromR2(previous.logoKey);
    } catch (_cleanupError) {
      // ignore cleanup failure
    }
  }

  return res.json({ site });
};

const uploadSiteFavicon = async (req, res) =>
  uploadSiteAsset(req, res, {
    field: "favicon",
    setFn: setSiteFavicon,
    objectPrefix: "favicon",
    defaultExt: "ico",
    defaultMime: "image/x-icon",
  });

const removeSiteFavicon = async (_req, res) => {
  const previous = await getSiteSettings();
  const site = await setSiteFavicon({ faviconUrl: "", faviconKey: "" });

  if (previous.faviconKey) {
    try {
      await deleteFileFromR2(previous.faviconKey);
    } catch (_cleanupError) {
      // ignore cleanup failure
    }
  }

  return res.json({ site });
};

const getPublicSettings = async (_req, res) => {
  const [site, seo] = await Promise.all([getSiteSettings(), getSeoSettings()]);
  return res.json({ site, seo });
};

module.exports = {
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
};
