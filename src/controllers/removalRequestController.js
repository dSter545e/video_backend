const mongoose = require("mongoose");
const Video = require("../models/Video");
const VideoRemovalRequest = require("../models/VideoRemovalRequest");
const { deleteFileFromR2, extractObjectKeyFromUrl } = require("../utils/r2Client");
const { cancelVideoProcessingJob } = require("../workers/videoProcessingWorker");

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const resolveVideoFilter = (identifier) =>
  isValidObjectId(identifier) ? { $or: [{ _id: identifier }, { slug: identifier }] } : { slug: identifier };

const extractVideoIdentifierFromUrl = (value) => {
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const videosIndex = parts.indexOf("videos");
    if (videosIndex >= 0 && parts[videosIndex + 1]) {
      return parts[videosIndex + 1];
    }
  } catch (_error) {
    // Not a full URL.
  }
  return value.trim();
};

const resolveVideoFromInput = async ({ videoId, videoUrl }) => {
  const candidates = [];
  if (videoId && typeof videoId === "string") {
    candidates.push(videoId.trim());
  }
  if (videoUrl && typeof videoUrl === "string") {
    candidates.push(extractVideoIdentifierFromUrl(videoUrl));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const video = await Video.findOne(resolveVideoFilter(candidate));
    if (video) return video;
  }
  return null;
};

const deleteVideoRecord = async (videoDoc) => {
  if (!videoDoc) return false;
  const video = videoDoc.toObject ? videoDoc.toObject() : videoDoc;

  if (video.processingStatus === "processing") {
    cancelVideoProcessingJob(String(video._id));
  }

  const deleted = await Video.findByIdAndDelete(video._id);
  if (!deleted) return false;

  const keysToDelete = [];
  const sourceVideoKey = deleted.sourceVideoKey || extractObjectKeyFromUrl(deleted.videoUrl);
  if (sourceVideoKey) keysToDelete.push(sourceVideoKey);

  const thumbnailKey = deleted.thumbnailKey || extractObjectKeyFromUrl(deleted.thumbnail);
  if (thumbnailKey) keysToDelete.push(thumbnailKey);

  if (Array.isArray(deleted.qualityVariants)) {
    for (const variant of deleted.qualityVariants) {
      const variantKey = variant?.key || extractObjectKeyFromUrl(variant?.url);
      if (variantKey) keysToDelete.push(variantKey);
    }
  }

  if (Array.isArray(deleted.hlsKeys)) {
    for (const key of deleted.hlsKeys) {
      if (key) keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    try {
      await deleteFileFromR2(key);
    } catch (_error) {
      // Continue deleting other files.
    }
  }

  return true;
};

const createRemovalRequest = async (req, res) => {
  const { videoId, videoUrl, requesterName, requesterEmail, reason, additionalInfo } = req.body || {};

  if (!requesterName || !requesterEmail || !reason) {
    return res.status(400).json({ error: "requesterName, requesterEmail and reason are required" });
  }

  if (!videoId && !videoUrl) {
    return res.status(400).json({ error: "videoId or videoUrl is required" });
  }

  const video = await resolveVideoFromInput({ videoId, videoUrl });
  const request = await VideoRemovalRequest.create({
    video: video?._id || null,
    videoTitle: video?.title || "",
    videoReference: String(videoUrl || videoId || "").trim(),
    requesterName: String(requesterName).trim(),
    requesterEmail: String(requesterEmail).trim().toLowerCase(),
    reason: String(reason).trim(),
    additionalInfo: String(additionalInfo || "").trim(),
    status: "pending",
  });

  const populated = await VideoRemovalRequest.findById(request._id).populate("video", "title slug");
  return res.status(201).json(populated);
};

const listRemovalRequestsAdmin = async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const filter = status && ["pending", "approved", "rejected"].includes(status) ? { status } : {};

  const requests = await VideoRemovalRequest.find(filter)
    .populate("video", "title slug thumbnail")
    .sort({ createdAt: -1 })
    .limit(200);

  return res.json(requests);
};

const updateRemovalRequestAdmin = async (req, res) => {
  const { id } = req.params;
  const { status, adminNotes, deleteVideo } = req.body || {};

  if (!status || !["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "status must be pending, approved, or rejected" });
  }

  const request = await VideoRemovalRequest.findById(id).populate("video");
  if (!request) {
    return res.status(404).json({ error: "Removal request not found" });
  }

  let videoDeleted = request.videoDeleted;
  if (status === "approved" && deleteVideo && request.video && !request.videoDeleted) {
    videoDeleted = await deleteVideoRecord(request.video);
  }

  request.status = status;
  request.adminNotes = adminNotes !== undefined ? String(adminNotes).trim() : request.adminNotes;
  request.reviewedBy = req.admin?.adminId || null;
  request.reviewedAt = new Date();
  request.videoDeleted = videoDeleted;
  await request.save();

  const updated = await VideoRemovalRequest.findById(id).populate("video", "title slug thumbnail");
  return res.json(updated);
};

const deleteRemovalRequestAdmin = async (req, res) => {
  const { id } = req.params;
  const deleted = await VideoRemovalRequest.findByIdAndDelete(id);
  if (!deleted) {
    return res.status(404).json({ error: "Removal request not found" });
  }
  return res.status(204).send();
};

module.exports = {
  createRemovalRequest,
  listRemovalRequestsAdmin,
  updateRemovalRequestAdmin,
  deleteRemovalRequestAdmin,
};
