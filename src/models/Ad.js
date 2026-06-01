const mongoose = require("mongoose");
const { AD_SLOT_IDS, AD_PAGE_KEYS } = require("../constants/adSlots");
const { AD_DEVICE_KEYS } = require("../constants/adDevices");

const adSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slot: { type: String, required: true, enum: AD_SLOT_IDS },
    type: { type: String, enum: ["html", "image", "video"], default: "html" },
    htmlContent: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    videoUrl: { type: String, default: "" },
    linkUrl: { type: String, default: "" },
    altText: { type: String, default: "Advertisement" },
    pages: {
      type: [String],
      default: ["all"],
      validate: {
        validator(values) {
          return Array.isArray(values) && values.length > 0 && values.every((page) => AD_PAGE_KEYS.includes(page));
        },
        message: "Invalid page targeting",
      },
    },
    devices: {
      type: [String],
      default: ["all"],
      validate: {
        validator(values) {
          return Array.isArray(values) && values.length > 0 && values.every((device) => AD_DEVICE_KEYS.includes(device));
        },
        message: "Invalid device targeting",
      },
    },
    inFeedEvery: { type: Number, default: 10, min: 4, max: 50 },
    skipAfterSeconds: { type: Number, default: 5, min: 0, max: 120 },
    popupDelaySeconds: { type: Number, default: 5, min: 0, max: 120 },
    popupCooldownMinutes: { type: Number, default: 30, min: 0, max: 1440 },
    priority: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
  },
  { timestamps: true }
);

adSchema.index({ slot: 1, isActive: 1, priority: -1 });

module.exports = mongoose.model("Ad", adSchema);
