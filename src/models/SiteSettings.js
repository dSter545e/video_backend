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
  },
  { timestamps: true }
);

module.exports = mongoose.model("SiteSettings", siteSettingsSchema);
