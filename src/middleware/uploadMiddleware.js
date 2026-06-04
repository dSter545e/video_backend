const multer = require("multer");
const path = require("path");
const os = require("os");

const MAX_FILE_BYTES = Number(process.env.UPLOAD_MAX_FILE_MB || 1024) * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || ".mp4");
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const uploadVideoFile = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only video files are allowed"));
  },
});

const uploadImageFile = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("Only image files are allowed"));
  },
});

const uploadVideoMedia = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === "video") {
      if (!file.mimetype.startsWith("video/")) {
        cb(new Error("Video field must be a video file"));
        return;
      }
      cb(null, true);
      return;
    }

    if (file.fieldname === "thumbnailImage" || file.fieldname === "image") {
      if (!file.mimetype.startsWith("image/")) {
        cb(new Error("Image field must be an image file"));
        return;
      }
      cb(null, true);
      return;
    }

    cb(new Error("Unsupported upload field"));
  },
});

module.exports = { uploadVideoFile, uploadImageFile, uploadVideoMedia };
