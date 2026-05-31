const fs = require("fs");
const { uploadFileToR2 } = require("../utils/r2Client");

const uploadImage = async (req, res) => {
  const uploadedFile = req.file;
  const folder = req.body.folder || "general";

  if (!uploadedFile) {
    return res.status(400).json({ error: "Image file is required" });
  }

  const safeFolder = String(folder).replace(/[^a-zA-Z0-9-_]/g, "-");
  const objectKey = `images/${safeFolder}/${Date.now()}-${uploadedFile.filename}`;

  try {
    const uploaded = await uploadFileToR2({
      localFilePath: uploadedFile.path,
      objectKey,
      contentType: uploadedFile.mimetype || "image/jpeg",
    });

    return res.status(201).json({
      url: uploaded.url,
      key: uploaded.key,
    });
  } catch (error) {
    return res.status(500).json({ error: `Image upload failed: ${error.message}` });
  } finally {
    if (uploadedFile?.path) {
      fs.rmSync(uploadedFile.path, { force: true });
    }
  }
};

module.exports = { uploadImage };
