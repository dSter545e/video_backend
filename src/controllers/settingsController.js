const fs = require("fs");
const {
  getWatermarkSettings,
  updateWatermarkSettings,
  setWatermarkLogo,
  normalizeWatermark,
} = require("../services/watermarkService");
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

module.exports = {
  getWatermark,
  updateWatermark,
  uploadWatermarkLogo,
  removeWatermarkLogo,
};
