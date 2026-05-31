const express = require("express");
const {
  getVideos,
  getVideosAdmin,
  getRecommendedVideos,
  getVideoById,
  createVideo,
  createProcessedVideo,
  updateVideo,
  deleteVideo,
  trackVideoView,
  getVideoComments,
  addVideoComment,
  reactToVideo,
  addVideoTags,
  suggestVideoTags,
} = require("../controllers/videoController");
const { adminAuth } = require("../middleware/authMiddleware");
const { uploadVideoMedia } = require("../middleware/uploadMiddleware");

const router = express.Router();

router.get("/", getVideos);
router.get("/recommended", getRecommendedVideos);
router.get("/admin/all", adminAuth, getVideosAdmin);
router.get("/tags/suggest", suggestVideoTags);
router.get("/:id/comments", getVideoComments);
router.get("/:id", getVideoById);
router.post("/:id/view", trackVideoView);
router.post("/:id/reaction", reactToVideo);
router.post("/:id/comments", addVideoComment);
router.post("/:id/tags", addVideoTags);
router.post("/", adminAuth, createVideo);
router.post("/upload", adminAuth, createVideo);
router.post(
  "/process-upload",
  adminAuth,
  uploadVideoMedia.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnailImage", maxCount: 1 },
  ]),
  createProcessedVideo
);
router.put("/:id", adminAuth, uploadVideoMedia.fields([{ name: "thumbnailImage", maxCount: 1 }]), updateVideo);
router.delete("/:id", adminAuth, deleteVideo);

module.exports = router;
