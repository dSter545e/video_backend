const mongoose = require("mongoose");

const siteSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true, trim: true },
    watermark: {
      enabled: { type: Boolean, default: false },
      mode: { type: String, enum: ["text", "logo"], default: "text" },
      text: { type: String, default: "xHub4u", trim: true, maxlength: 80 },
      logoUrl: { type: String, default: "", trim: true },
      logoKey: { type: String, default: "", trim: true },
      opacity: { type: Number, default: 0.85, min: 0.1, max: 1 },
      margin: { type: Number, default: 12, min: 0, max: 120 },
    },
    site: {
      tagline: { type: String, default: "", trim: true, maxlength: 160 },
      logoUrl: { type: String, default: "", trim: true },
      logoKey: { type: String, default: "", trim: true },
      faviconUrl: { type: String, default: "", trim: true },
      faviconKey: { type: String, default: "", trim: true },
      footerAbout: { type: String, default: "", trim: true, maxlength: 500 },
      contactEmail: { type: String, default: "", trim: true, maxlength: 120 },
      supportEmail: { type: String, default: "", trim: true, maxlength: 120 },
    },
    seo: {
      siteName: { type: String, default: "xHub4u", trim: true, maxlength: 80 },
      defaultTitle: { type: String, default: "", trim: true, maxlength: 70 },
      defaultDescription: { type: String, default: "", trim: true, maxlength: 160 },
      defaultKeywords: { type: String, default: "", trim: true, maxlength: 255 },
      defaultOgImage: { type: String, default: "", trim: true },
      defaultOgImageKey: { type: String, default: "", trim: true },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
