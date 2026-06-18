const fs = require("fs");
const path = require("path");
const os = require("os");
const SiteSettings = require("../models/SiteSettings");
const { downloadFileFromR2 } = require("../utils/r2Client");

const SETTINGS_KEY = "global";

const DEFAULT_WATERMARK = {
  enabled: false,
  mode: "text",
  text: "xHub4u",
  logoUrl: "",
  logoKey: "",
  opacity: 0.85,
  margin: 12,
};

const getDefaultFontPath = () => {
  const candidates =
    process.platform === "win32"
      ? ["C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf"]
      : [
          "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
          "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
          "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
};

const escapeDrawtext = (text) =>
  String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,");

const escapeFilterPath = (filePath) =>
  String(filePath || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:");

const normalizeWatermark = (watermark = {}) => {
  const opacityRaw = Number(watermark.opacity ?? DEFAULT_WATERMARK.opacity);
  const marginRaw = Number(watermark.margin ?? DEFAULT_WATERMARK.margin);

  return {
    enabled: watermark.enabled === true,
    mode: watermark.mode === "logo" ? "logo" : "text",
    text: (watermark.text || DEFAULT_WATERMARK.text).trim() || DEFAULT_WATERMARK.text,
    logoUrl: watermark.logoUrl || "",
    logoKey: watermark.logoKey || "",
    opacity: Number.isFinite(opacityRaw) ? Math.min(1, Math.max(0.1, opacityRaw)) : DEFAULT_WATERMARK.opacity,
    margin: Number.isFinite(marginRaw) ? Math.min(120, Math.max(0, marginRaw)) : DEFAULT_WATERMARK.margin,
  };
};

const getOrCreateSiteSettings = async () => {
  let doc = await SiteSettings.findOne({ key: SETTINGS_KEY });
  if (!doc) {
    doc = await SiteSettings.create({ key: SETTINGS_KEY });
  }
  return doc;
};

const getWatermarkSettings = async () => {
  const doc = await SiteSettings.findOne({ key: SETTINGS_KEY }).lean();
  return normalizeWatermark(doc?.watermark || {});
};

const updateWatermarkSettings = async (payload = {}) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeWatermark(doc.watermark || {});

  if (payload.enabled !== undefined) {
    current.enabled = Boolean(payload.enabled);
  }
  if (payload.mode === "text" || payload.mode === "logo") {
    current.mode = payload.mode;
  }
  if (typeof payload.text === "string") {
    current.text = payload.text.trim().slice(0, 80) || "xHub4u";
  }
  if (payload.opacity !== undefined) {
    const opacity = Number(payload.opacity);
    if (Number.isFinite(opacity)) {
      current.opacity = Math.min(1, Math.max(0.1, opacity));
    }
  }
  if (payload.margin !== undefined) {
    const margin = Number(payload.margin);
    if (Number.isFinite(margin)) {
      current.margin = Math.min(120, Math.max(0, margin));
    }
  }

  doc.watermark = current;
  await doc.save();
  return normalizeWatermark(doc.watermark);
};

const setWatermarkLogo = async ({ logoUrl, logoKey }) => {
  const doc = await getOrCreateSiteSettings();
  const current = normalizeWatermark(doc.watermark || {});
  current.logoUrl = logoUrl || "";
  current.logoKey = logoKey || "";
  current.mode = "logo";
  doc.watermark = current;
  await doc.save();
  return normalizeWatermark(doc.watermark);
};

const isWatermarkActive = (watermark) => {
  if (!watermark?.enabled) return false;
  if (watermark.mode === "logo") {
    return Boolean(watermark.logoKey || watermark.logoUrl || watermark.text);
  }
  return Boolean(watermark.text);
};

const scaledMargin = (watermark, targetHeight) =>
  Math.max(4, Math.round((watermark.margin || 12) * (targetHeight / 720)));

const buildTextWatermarkFilter = ({ targetHeight, watermark }) => {
  const margin = scaledMargin(watermark, targetHeight);
  const fontSize = Math.max(14, Math.round(targetHeight / 28));
  const alpha = watermark.opacity.toFixed(2);
  const text = escapeDrawtext(watermark.text);
  const fontPath = getDefaultFontPath();
  const fontArg = fontPath ? `fontfile='${escapeFilterPath(fontPath)}':` : "";

  return `[0:v]scale=-2:${targetHeight},drawtext=${fontArg}text='${text}':fontsize=${fontSize}:fontcolor=white@${alpha}:borderw=2:bordercolor=black@0.5:x=${margin}:y=h-th-${margin}[vout]`;
};

const buildLogoWatermarkFilter = ({ targetHeight, watermark }) => {
  const margin = scaledMargin(watermark, targetHeight);
  const logoHeight = Math.max(24, Math.round(targetHeight * 0.08));
  const alpha = watermark.opacity.toFixed(2);

  return `[0:v]scale=-2:${targetHeight}[base];[1:v]scale=-2:${logoHeight},format=rgba,colorchannelmixer=aa=${alpha}[wm];[base][wm]overlay=${margin}:H-h-${margin}[vout]`;
};

const buildThumbnailWatermarkFilter = ({ watermark, hasLogoInput }) => {
  const targetHeight = 720;
  if (watermark.mode === "logo" && hasLogoInput) {
    return buildLogoWatermarkFilter({ targetHeight, watermark });
  }
  return buildTextWatermarkFilter({ targetHeight, watermark });
};

const buildVariantWatermarkFilter = ({ targetHeight, watermark, hasLogoInput }) => {
  if (watermark.mode === "logo" && hasLogoInput) {
    return buildLogoWatermarkFilter({ targetHeight, watermark });
  }
  return buildTextWatermarkFilter({ targetHeight, watermark });
};

const prepareWatermarkLogoFile = async ({ watermark, serverConfig }) => {
  if (!watermark?.enabled || watermark.mode !== "logo" || !watermark.logoKey) {
    return null;
  }

  const buffer = await downloadFileFromR2(watermark.logoKey, serverConfig);
  const ext = path.extname(watermark.logoKey) || ".png";
  const logoPath = path.join(os.tmpdir(), `watermark-logo-${Date.now()}${ext}`);
  fs.writeFileSync(logoPath, buffer);
  return logoPath;
};

module.exports = {
  getWatermarkSettings,
  updateWatermarkSettings,
  setWatermarkLogo,
  normalizeWatermark,
  isWatermarkActive,
  buildVariantWatermarkFilter,
  buildThumbnailWatermarkFilter,
  prepareWatermarkLogoFile,
};
