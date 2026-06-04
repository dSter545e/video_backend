const multer = require("multer");

const MAX_UPLOAD_MB = Number(process.env.UPLOAD_MAX_FILE_MB || 1024);

/**
 * Wraps multer middleware so errors return JSON instead of dropping the connection.
 */
const handleUpload =
  (uploadMiddleware) =>
  (req, res, next) => {
    uploadMiddleware(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          res.status(413).json({
            error: `File is too large. Maximum upload size is ${MAX_UPLOAD_MB}MB.`,
          });
          return;
        }
        res.status(400).json({ error: error.message || "Invalid upload" });
        return;
      }

      res.status(400).json({ error: error.message || "Upload failed" });
    });
  };

module.exports = { handleUpload };
