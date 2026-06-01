const mongoose = require("mongoose");
const Ad = require("../models/Ad");
const { AD_SLOTS, AD_SLOT_IDS, AD_PAGE_KEYS, getSlotMeta } = require("../constants/adSlots");
const { AD_DEVICE_KEYS, AD_DEVICES } = require("../constants/adDevices");

const isAdScheduledActive = (ad, now = new Date()) => {
  if (!ad.isActive) return false;
  if (ad.startAt && new Date(ad.startAt) > now) return false;
  if (ad.endAt && new Date(ad.endAt) < now) return false;
  return true;
};

const matchesPage = (ad, page) => {
  const pages = Array.isArray(ad.pages) && ad.pages.length ? ad.pages : ["all"];
  if (pages.includes("all")) return true;
  return pages.includes(page);
};

const normalizeDevices = (devices) => {
  if (!Array.isArray(devices) || !devices.length) return ["all"];
  const valid = devices.filter((device) => AD_DEVICE_KEYS.includes(device));
  return valid.length ? valid : ["all"];
};

const matchesDevice = (ad, device) => {
  if (!device || device === "all") return true;
  const devices = Array.isArray(ad.devices) && ad.devices.length ? ad.devices : ["all"];
  if (devices.includes("all")) return true;
  return devices.includes(device);
};

const serializeAd = (ad) => ({
  _id: ad._id,
  name: ad.name,
  slot: ad.slot,
  type: ad.type,
  htmlContent: ad.htmlContent || "",
  imageUrl: ad.imageUrl || "",
  videoUrl: ad.videoUrl || "",
  linkUrl: ad.linkUrl || "",
  altText: ad.altText || "Advertisement",
  pages: ad.pages || ["all"],
  devices: ad.devices || ["all"],
  inFeedEvery: ad.inFeedEvery || 10,
  skipAfterSeconds: ad.skipAfterSeconds ?? 5,
  popupDelaySeconds: ad.popupDelaySeconds ?? 5,
  popupCooldownMinutes: ad.popupCooldownMinutes ?? 30,
  priority: ad.priority || 0,
  isActive: Boolean(ad.isActive),
  startAt: ad.startAt || null,
  endAt: ad.endAt || null,
  createdAt: ad.createdAt,
  updatedAt: ad.updatedAt,
});

const getPublicAds = async (req, res) => {
  const page = typeof req.query.page === "string" ? req.query.page.trim() : "all";
  const slot = typeof req.query.slot === "string" ? req.query.slot.trim() : "";
  const deviceRaw = typeof req.query.device === "string" ? req.query.device.trim().toLowerCase() : "all";
  const device = AD_DEVICE_KEYS.includes(deviceRaw) && deviceRaw !== "all" ? deviceRaw : "";

  const now = new Date();
  const ads = await Ad.find({ isActive: true }).sort({ priority: -1, createdAt: -1 });

  const active = ads.filter(
    (ad) => isAdScheduledActive(ad, now) && matchesPage(ad, page) && matchesDevice(ad, device)
  );

  if (slot) {
    if (!AD_SLOT_IDS.includes(slot)) {
      return res.status(400).json({ error: "Invalid ad slot" });
    }
    return res.json(active.filter((ad) => ad.slot === slot).map(serializeAd));
  }

  const grouped = {};
  for (const slotId of AD_SLOT_IDS) {
    grouped[slotId] = active.filter((ad) => ad.slot === slotId).map(serializeAd);
  }
  return res.json({ page, device: device || "all", ads: grouped });
};

const getAdSlotsMeta = async (_req, res) => {
  return res.json({ slots: AD_SLOTS, pages: AD_PAGE_KEYS, devices: AD_DEVICES });
};

const listAdsAdmin = async (_req, res) => {
  const ads = await Ad.find().sort({ slot: 1, priority: -1, createdAt: -1 });
  return res.json(ads.map(serializeAd));
};

const createAdAdmin = async (req, res) => {
  const {
    name,
    slot,
    type = "html",
    htmlContent = "",
    imageUrl = "",
    videoUrl = "",
    linkUrl = "",
    altText = "Advertisement",
    pages = ["all"],
    devices = ["all"],
    inFeedEvery = 10,
    skipAfterSeconds = 5,
    popupDelaySeconds = 5,
    popupCooldownMinutes = 30,
    priority = 0,
    isActive = true,
    startAt,
    endAt,
  } = req.body || {};

  if (!name || !slot) {
    return res.status(400).json({ error: "name and slot are required" });
  }
  if (!AD_SLOT_IDS.includes(slot)) {
    return res.status(400).json({ error: "Invalid ad slot" });
  }
  if (!["html", "image", "video"].includes(type)) {
    return res.status(400).json({ error: "type must be html, image, or video" });
  }
  if (type === "html" && !String(htmlContent).trim()) {
    return res.status(400).json({ error: "htmlContent is required for HTML ads" });
  }
  if (type === "image" && !String(imageUrl).trim()) {
    return res.status(400).json({ error: "imageUrl is required for image ads" });
  }
  if (type === "video" && !String(videoUrl).trim()) {
    return res.status(400).json({ error: "videoUrl is required for video ads" });
  }

  const slotMeta = getSlotMeta(slot);
  const ad = await Ad.create({
    name: String(name).trim(),
    slot,
    type,
    htmlContent: String(htmlContent).trim(),
    imageUrl: String(imageUrl).trim(),
    videoUrl: String(videoUrl).trim(),
    linkUrl: String(linkUrl).trim(),
    altText: String(altText).trim() || "Advertisement",
    pages: Array.isArray(pages) && pages.length ? pages : ["all"],
    devices: normalizeDevices(devices),
    inFeedEvery: slotMeta?.placementType === "in_feed" ? Number(inFeedEvery) || 10 : 10,
    skipAfterSeconds: Number(skipAfterSeconds) ?? 5,
    popupDelaySeconds: Number(popupDelaySeconds) ?? 5,
    popupCooldownMinutes: Number(popupCooldownMinutes) ?? 30,
    priority: Number(priority) || 0,
    isActive: Boolean(isActive),
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
  });

  return res.status(201).json(serializeAd(ad));
};

const updateAdAdmin = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const ad = await Ad.findById(id);
  if (!ad) return res.status(404).json({ error: "Ad not found" });

  const body = req.body || {};
  if (body.name !== undefined) ad.name = String(body.name).trim();
  if (body.slot !== undefined) {
    if (!AD_SLOT_IDS.includes(body.slot)) return res.status(400).json({ error: "Invalid ad slot" });
    ad.slot = body.slot;
  }
  if (body.type !== undefined) {
    if (!["html", "image", "video"].includes(body.type)) return res.status(400).json({ error: "type must be html, image, or video" });
    ad.type = body.type;
  }
  if (body.htmlContent !== undefined) ad.htmlContent = String(body.htmlContent);
  if (body.imageUrl !== undefined) ad.imageUrl = String(body.imageUrl).trim();
  if (body.videoUrl !== undefined) ad.videoUrl = String(body.videoUrl).trim();
  if (body.linkUrl !== undefined) ad.linkUrl = String(body.linkUrl).trim();
  if (body.altText !== undefined) ad.altText = String(body.altText).trim() || "Advertisement";
  if (body.pages !== undefined) ad.pages = Array.isArray(body.pages) && body.pages.length ? body.pages : ["all"];
  if (body.devices !== undefined) ad.devices = normalizeDevices(body.devices);
  if (body.inFeedEvery !== undefined) ad.inFeedEvery = Number(body.inFeedEvery) || 10;
  if (body.skipAfterSeconds !== undefined) ad.skipAfterSeconds = Number(body.skipAfterSeconds) ?? 5;
  if (body.popupDelaySeconds !== undefined) ad.popupDelaySeconds = Number(body.popupDelaySeconds) ?? 5;
  if (body.popupCooldownMinutes !== undefined) ad.popupCooldownMinutes = Number(body.popupCooldownMinutes) ?? 30;
  if (body.priority !== undefined) ad.priority = Number(body.priority) || 0;
  if (body.isActive !== undefined) ad.isActive = Boolean(body.isActive);
  if (body.startAt !== undefined) ad.startAt = body.startAt ? new Date(body.startAt) : null;
  if (body.endAt !== undefined) ad.endAt = body.endAt ? new Date(body.endAt) : null;

  await ad.save();
  return res.json(serializeAd(ad));
};

const deleteAdAdmin = async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid id" });
  }
  const deleted = await Ad.findByIdAndDelete(id);
  if (!deleted) return res.status(404).json({ error: "Ad not found" });
  return res.status(204).send();
};

module.exports = {
  getPublicAds,
  getAdSlotsMeta,
  listAdsAdmin,
  createAdAdmin,
  updateAdAdmin,
  deleteAdAdmin,
};
