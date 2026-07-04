const SiteSettings = require("../models/SiteSettings");

const SETTINGS_KEY = "global";

const DEFAULT_SITE = {
  tagline: "",
  logoUrl: "",
  logoKey: "",
  faviconUrl: "",
  faviconKey: "",
  footerAbout: "",
  contactEmail: "",
  supportEmail: "",
};

const normalizeSite = (site = {}) => ({
  tagline: (site.tagline || "").trim().slice(0, 160),
  logoUrl: site.logoUrl || "",
  logoKey: site.logoKey || "",
  faviconUrl: site.faviconUrl || "",
  faviconKey: site.faviconKey || "",
  footerAbout: (site.footerAbout || "").trim().slice(0, 500),
  contactEmail: (site.contactEmail || "").trim().slice(0, 120),
  supportEmail: (site.supportEmail || "").trim().slice(0, 120),
});

const getOrCreateSiteSettings = async () => {
  let doc = await SiteSettings.findOne({ key: SETTINGS_KEY });
  if (!doc) {
    doc = await SiteSettings.create({ key: SETTINGS_KEY });
  }
  return doc;
};

const getSiteSettings = async () => {
  const doc = await SiteSettings.findOne({ key: SETTINGS_KEY }).lean();
  return normalizeSite(doc?.site || {});
};

const updateSiteSettings = async (payload = {}) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeSite(doc.site || {});

  if (typeof payload.tagline === "string") {
    current.tagline = payload.tagline.trim().slice(0, 160);
  }
  if (typeof payload.footerAbout === "string") {
    current.footerAbout = payload.footerAbout.trim().slice(0, 500);
  }
  if (typeof payload.contactEmail === "string") {
    current.contactEmail = payload.contactEmail.trim().slice(0, 120);
  }
  if (typeof payload.supportEmail === "string") {
    current.supportEmail = payload.supportEmail.trim().slice(0, 120);
  }

  doc.site = current;
  await doc.save();
  return normalizeSite(doc.site);
};

const setSiteLogo = async ({ logoUrl, logoKey }) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeSite(doc.site || {});
  current.logoUrl = logoUrl || "";
  current.logoKey = logoKey || "";
  doc.site = current;
  await doc.save();
  return normalizeSite(doc.site);
};

const setSiteFavicon = async ({ faviconUrl, faviconKey }) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeSite(doc.site || {});
  current.faviconUrl = faviconUrl || "";
  current.faviconKey = faviconKey || "";
  doc.site = current;
  await doc.save();
  return normalizeSite(doc.site);
};

module.exports = {
  getSiteSettings,
  updateSiteSettings,
  setSiteLogo,
  setSiteFavicon,
  normalizeSite,
  DEFAULT_SITE,
};
