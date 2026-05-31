const fs = require("fs");
const mongoose = require("mongoose");
const Video = require("../models/Video");
const Category = require("../models/Category");
const VideoReaction = require("../models/VideoReaction");
const VideoComment = require("../models/VideoComment");
const VideoTag = require("../models/VideoTag");
const VisitorEvent = require("../models/VisitorEvent");
const { uploadFileToR2, deleteFileFromR2, extractObjectKeyFromUrl } = require("../utils/r2Client");
const { startVideoProcessingJob, cancelVideoProcessingJob } = require("../workers/videoProcessingWorker");
const { buildUniqueSlug } = require("../utils/slug");
const { withMediaProxyUrls, withMediaProxyUrlsList } = require("../utils/mediaProxy");

const FINAL_VIDEO_STATUSES = ["public", "private", "draft", "active", "inactive"];
const normalizeFinalStatus = (status) => {
  if (status === "active") return "public";
  if (status === "inactive") return "private";
  return status;
};
const videoDebugLog = () => {};
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const resolveVideoFilter = (identifier) => (isValidObjectId(identifier) ? { $or: [{ _id: identifier }, { slug: identifier }] } : { slug: identifier });
const resolveCategoryFilter = (identifier) =>
  isValidObjectId(identifier) ? { $or: [{ _id: identifier }, { slug: identifier }] } : { slug: identifier };

const normalizeTagName = (value = "") => value.trim().toLowerCase().replace(/\s+/g, " ");
const coerceTagsInput = (...values) => {
  for (const value of values) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [];
};

const resolveIncomingTags = (body) => {
  const tagsFromArrayField = body?.["tags[]"];
  const tagsFromDefaultField = body?.tags;
  return coerceTagsInput(tagsFromDefaultField, tagsFromArrayField);
};

const suggestVideoTags = async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const normalized = normalizeTagName(query);
  const regex = normalized ? new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const where = regex ? { $or: [{ name: regex }, { displayName: regex }] } : {};
  const tags = await VideoTag.find(where).sort({ displayName: 1 }).limit(15);
  return res.json(tags.map((tag) => ({ _id: tag._id, name: tag.name, displayName: tag.displayName })));
};

const resolveTags = async (inputTags = []) => {
  const cleaned = inputTags
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 20);

  const normalizedMap = new Map();
  for (const rawTag of cleaned) {
    const normalized = normalizeTagName(rawTag);
    if (!normalized || normalized.length > 60) continue;
    if (!normalizedMap.has(normalized)) {
      normalizedMap.set(normalized, rawTag);
    }
  }

  const normalizedTags = Array.from(normalizedMap.keys());
  if (!normalizedTags.length) return [];

  const existingTags = await VideoTag.find({ name: { $in: normalizedTags } });
  const existingMap = new Map(existingTags.map((tag) => [tag.name, tag]));
  const createdTags = [];

  for (const normalized of normalizedTags) {
    if (existingMap.has(normalized)) continue;
    const displayName = normalizedMap.get(normalized);
    try {
      const created = await VideoTag.create({
        name: normalized,
        displayName,
      });
      createdTags.push(created);
      existingMap.set(normalized, created);
    } catch (_error) {
      const found = await VideoTag.findOne({ name: normalized });
      if (found) existingMap.set(normalized, found);
    }
  }

  return normalizedTags
    .map((normalized) => existingMap.get(normalized))
    .filter(Boolean)
    .map((tag) => tag._id);
};

const attachEngagementData = async (videoDoc, userIdentifier = "") => {
  const videoId = videoDoc._id;
  const [reactions, commentsCount, userReaction, populatedVideo] = await Promise.all([
    VideoReaction.aggregate([
      { $match: { video: videoId } },
      { $group: { _id: "$reaction", count: { $sum: 1 } } },
    ]),
    VideoComment.countDocuments({ video: videoId, isActive: true }),
    userIdentifier ? VideoReaction.findOne({ video: videoId, userIdentifier }) : null,
    Video.findById(videoId).populate("category", "name imageUrl").populate("tags", "name displayName"),
  ]);

  const likes = reactions.find((item) => item._id === "like")?.count || 0;
  const dislikes = reactions.find((item) => item._id === "dislike")?.count || 0;

  const video = populatedVideo?.toObject() || videoDoc.toObject();
  video.likesCount = likes;
  video.dislikesCount = dislikes;
  video.commentsCount = commentsCount;
  video.userReaction = userReaction?.reaction || null;
  return video;
};

const attachEngagementDataToList = async (videos) => {
  if (!videos.length) return [];
  const videoIds = videos.map((video) => video._id);
  const [reactionAgg, commentAgg] = await Promise.all([
    VideoReaction.aggregate([
      { $match: { video: { $in: videoIds } } },
      { $group: { _id: { video: "$video", reaction: "$reaction" }, count: { $sum: 1 } } },
    ]),
    VideoComment.aggregate([
      { $match: { video: { $in: videoIds }, isActive: true } },
      { $group: { _id: "$video", count: { $sum: 1 } } },
    ]),
  ]);

  const likesMap = new Map();
  const dislikesMap = new Map();
  for (const item of reactionAgg) {
    const id = item._id.video.toString();
    if (item._id.reaction === "like") likesMap.set(id, item.count);
    if (item._id.reaction === "dislike") dislikesMap.set(id, item.count);
  }
  const commentsMap = new Map(commentAgg.map((item) => [item._id.toString(), item.count]));

  return videos.map((video) => {
    const json = video.toObject();
    const id = json._id.toString();
    json.likesCount = likesMap.get(id) || 0;
    json.dislikesCount = dislikesMap.get(id) || 0;
    json.commentsCount = commentsMap.get(id) || 0;
    return json;
  });
};

const uploadThumbnailIfPresent = async (file) => {
  if (!file) return null;
  const objectKey = `images/thumbnails/${Date.now()}-${file.filename}`;
  const uploaded = await uploadFileToR2({
    localFilePath: file.path,
    objectKey,
    contentType: file.mimetype || "image/jpeg",
  });
  return uploaded;
};

const EVENT_WEIGHTS = {
  video_click: 2,
  video_watch_progress: 4,
  video_reaction: 5,
  video_comment: 6,
};

const getRecommendedVideos = async (req, res) => {
  const visitorId = typeof req.query.visitorId === "string" ? req.query.visitorId.trim() : "";
  const currentVideoId = typeof req.query.currentVideoId === "string" ? req.query.currentVideoId.trim() : "";
  const limit = Math.min(parsePositiveInt(req.query.limit, 12), 24);
  const publicFilter = { processingStatus: { $in: ["public", "active", "ready"] } };

  let resolvedCurrentVideo = null;
  if (currentVideoId) {
    resolvedCurrentVideo = await Video.findOne(resolveVideoFilter(currentVideoId)).select("_id category tags");
  }

  if (!visitorId) {
    const fallbackVideos = await Video.find({
      ...publicFilter,
      ...(resolvedCurrentVideo?._id ? { _id: { $ne: resolvedCurrentVideo._id } } : {}),
    })
      .populate("category", "name imageUrl")
      .populate("tags", "name displayName")
      .sort({ viewsCount: -1, createdAt: -1 })
      .limit(limit);
    const enhancedFallback = withMediaProxyUrlsList(await attachEngagementDataToList(fallbackVideos), req);
    return res.json(enhancedFallback);
  }

  const relevantEvents = await VisitorEvent.find({
    visitorId,
    eventType: { $in: Object.keys(EVENT_WEIGHTS) },
  })
    .sort({ occurredAt: -1 })
    .limit(500)
    .select("eventType metadata occurredAt");

  const interactedScoreByVideoId = new Map();
  for (const event of relevantEvents) {
    const videoId = event?.metadata?.videoId;
    if (!videoId || !isValidObjectId(videoId)) continue;
    const currentScore = interactedScoreByVideoId.get(videoId) || 0;
    interactedScoreByVideoId.set(videoId, currentScore + (EVENT_WEIGHTS[event.eventType] || 1));
  }

  const interactedVideoIds = Array.from(interactedScoreByVideoId.keys());
  const interactedVideos = interactedVideoIds.length
    ? await Video.find({ _id: { $in: interactedVideoIds } }).select("_id category tags")
    : [];

  const categoryPreference = new Map();
  const tagPreference = new Map();
  for (const video of interactedVideos) {
    const videoScore = interactedScoreByVideoId.get(video._id.toString()) || 0;
    if (video.category) {
      const key = String(video.category);
      categoryPreference.set(key, (categoryPreference.get(key) || 0) + videoScore);
    }
    if (Array.isArray(video.tags)) {
      for (const tag of video.tags) {
        const key = String(tag);
        tagPreference.set(key, (tagPreference.get(key) || 0) + videoScore);
      }
    }
  }

  const excludeIds = new Set(interactedVideoIds);
  if (resolvedCurrentVideo?._id) excludeIds.add(resolvedCurrentVideo._id.toString());

  const candidates = await Video.find({
    ...publicFilter,
    ...(excludeIds.size ? { _id: { $nin: Array.from(excludeIds) } } : {}),
  })
    .populate("category", "name imageUrl")
    .populate("tags", "name displayName")
    .sort({ viewsCount: -1, createdAt: -1 })
    .limit(200);

  const now = Date.now();
  const scored = candidates.map((video) => {
    let score = 0;
    const categoryId = video.category?._id ? String(video.category._id) : "";
    score += categoryPreference.get(categoryId) || 0;
    if (Array.isArray(video.tags)) {
      for (const tag of video.tags) {
        score += tagPreference.get(String(tag._id || tag)) || 0;
      }
    }
    if (resolvedCurrentVideo?.category && categoryId && String(resolvedCurrentVideo.category) === categoryId) {
      score += 8;
    }
    if (Array.isArray(resolvedCurrentVideo?.tags) && Array.isArray(video.tags)) {
      const currentTagSet = new Set((resolvedCurrentVideo.tags || []).map((tag) => String(tag)));
      const overlap = video.tags.reduce((sum, tag) => sum + (currentTagSet.has(String(tag._id || tag)) ? 1 : 0), 0);
      score += overlap * 4;
    }
    const ageDays = Math.max(0, (now - new Date(video.createdAt || now).getTime()) / (1000 * 60 * 60 * 24));
    score += Math.max(0, 7 - ageDays * 0.15);
    score += (video.viewsCount || 0) * 0.01;
    score += (video.likesCount || 0) * 0.2;
    score += (video.commentsCount || 0) * 0.1;
    return { video, score };
  });

  const picked = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.video);

  if (!picked.length) {
    const fallbackVideos = await Video.find({
      ...publicFilter,
      ...(resolvedCurrentVideo?._id ? { _id: { $ne: resolvedCurrentVideo._id } } : {}),
    })
      .populate("category", "name imageUrl")
      .populate("tags", "name displayName")
      .sort({ viewsCount: -1, createdAt: -1 })
      .limit(limit);
    const enhancedFallback = withMediaProxyUrlsList(await attachEngagementDataToList(fallbackVideos), req);
    return res.json(enhancedFallback);
  }

  const enhanced = withMediaProxyUrlsList(await attachEngagementDataToList(picked), req);
  return res.json(enhanced);
};

const resolveVideoSort = (sort) => {
  switch (String(sort || "").toLowerCase()) {
    case "most_viewed":
      return { viewsCount: -1, createdAt: -1 };
    case "top_rated":
      return { viewsCount: -1, createdAt: -1 };
    case "long_duration":
      return { durationSeconds: -1, createdAt: -1 };
    case "short_duration":
      return { durationSeconds: 1, createdAt: -1 };
    case "recent":
    default:
      return { createdAt: -1 };
  }
};

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const getVideos = async (req, res) => {
  const { categoryId, sort, paginate } = req.query;
  const query = { processingStatus: { $in: ["public", "active", "ready"] } };
  if (categoryId) {
    const category = await Category.findOne(resolveCategoryFilter(categoryId)).select("_id");
    if (!category) return res.json([]);
    query.category = category._id;
  }
  const sortQuery = resolveVideoSort(sort);
  const shouldPaginate = ["1", "true", "yes", "on"].includes(String(paginate || "").toLowerCase());
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 50);
  videoDebugLog("Fetching videos", { categoryId: categoryId || null });

  const baseQuery = Video.find(query).populate("category", "name imageUrl").populate("tags", "name displayName").sort(sortQuery);
  const videos = shouldPaginate ? await baseQuery.skip((page - 1) * limit).limit(limit) : await baseQuery;

  const enhanced = withMediaProxyUrlsList(await attachEngagementDataToList(videos), req);
  if (shouldPaginate) {
    const totalItems = await Video.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    return res.json({
      items: enhanced,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  }
  return res.json(enhanced);
};

const getVideosAdmin = async (req, res) => {
  const { sort, paginate } = req.query;
  const sortQuery = resolveVideoSort(sort);
  const shouldPaginate = ["1", "true", "yes", "on"].includes(String(paginate || "").toLowerCase());
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
  videoDebugLog("Fetching all videos for admin");
  const baseQuery = Video.find().populate("category", "name imageUrl").populate("tags", "name displayName").sort(sortQuery);
  const videos = shouldPaginate ? await baseQuery.skip((page - 1) * limit).limit(limit) : await baseQuery;
  const enhanced = await attachEngagementDataToList(videos);
  if (shouldPaginate) {
    const totalItems = await Video.countDocuments({});
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    return res.json({
      items: enhanced,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  }
  return res.json(enhanced);
};

const createVideo = async (req, res) => {
  const { title, description, thumbnail, videoUrl, categoryId, status, slug, tags = [] } = req.body;
  videoDebugLog("Create direct video request", {
    title,
    hasDescription: Boolean(description),
    hasThumbnail: Boolean(thumbnail),
    hasVideoUrl: Boolean(videoUrl),
    categoryId,
  });

  if (!title || !videoUrl || !categoryId) {
    return res.status(400).json({ error: "title, videoUrl and categoryId are required" });
  }

  const category = await Category.findOne(resolveCategoryFilter(categoryId)).select("_id");
  if (!category) {
    videoDebugLog("Create direct video failed: category not found", { categoryId });
    return res.status(404).json({ error: "Category not found" });
  }

  const tagIds = await resolveTags(resolveIncomingTags(req.body));
  const videoSlug = await buildUniqueSlug({
    source: title,
    providedSlug: slug,
    exists: async (candidate) => Boolean(await Video.exists({ slug: candidate })),
  });
  const video = await Video.create({
    title,
    slug: videoSlug,
    description: description || "",
    thumbnail: thumbnail || "",
    videoUrl,
    processingStatus: FINAL_VIDEO_STATUSES.includes(status) ? normalizeFinalStatus(status) : "public",
    finalStatus: FINAL_VIDEO_STATUSES.includes(status) ? normalizeFinalStatus(status) : "public",
    category: category._id,
    tags: tagIds,
  });

  await video.populate("category", "name imageUrl");
  await video.populate("tags", "name displayName");
  const populated = video;
  videoDebugLog("Create direct video success", { videoId: video._id.toString() });
  return res.status(201).json(populated);
};

const createProcessedVideo = async (req, res) => {
  const { title, description, thumbnail, categoryId, status, slug, tags = [] } = req.body;
  const uploadedVideoFile = req.files?.video?.[0];
  const uploadedThumbnailFile = req.files?.thumbnailImage?.[0];
  videoDebugLog("Create processed video request", {
    title,
    categoryId,
    hasDescription: Boolean(description),
    hasThumbnailUrl: Boolean(thumbnail),
    hasVideoFile: Boolean(uploadedVideoFile),
    hasThumbnailFile: Boolean(uploadedThumbnailFile),
  });

  if (!title || !categoryId || !uploadedVideoFile) {
    videoDebugLog("Create processed video failed: missing required fields");
    return res.status(400).json({ error: "title, categoryId and video file are required" });
  }

  const category = await Category.findOne(resolveCategoryFilter(categoryId)).select("_id");
  if (!category) {
    videoDebugLog("Create processed video failed: category not found", { categoryId });
    return res.status(404).json({ error: "Category not found" });
  }

  const finalStatus = FINAL_VIDEO_STATUSES.includes(status) ? normalizeFinalStatus(status) : "public";
  let uploadedThumbKey = "";
  let workerStarted = false;
  try {
    videoDebugLog("Starting thumbnail upload (if provided)", {
      hasThumbnailFile: Boolean(uploadedThumbnailFile),
      thumbnailTempPath: uploadedThumbnailFile?.path || null,
    });
    const uploadedThumb = await uploadThumbnailIfPresent(uploadedThumbnailFile);
    uploadedThumbKey = uploadedThumb?.key || "";

    const tagIds = await resolveTags(resolveIncomingTags(req.body));
    const videoSlug = await buildUniqueSlug({
      source: title,
      providedSlug: slug,
      exists: async (candidate) => Boolean(await Video.exists({ slug: candidate })),
    });
    const video = await Video.create({
      title,
      slug: videoSlug,
      description: description || "",
      thumbnail: uploadedThumb?.url || thumbnail || "",
      thumbnailKey: uploadedThumb?.key || "",
      videoUrl: "about:blank",
      sourceVideoKey: "",
      durationSeconds: 0,
      maxSourceHeight: 0,
      qualityVariants: [],
      processingStatus: "processing",
      finalStatus,
      category: category._id,
      tags: tagIds,
    });

    await video.populate("category", "name imageUrl");
    await video.populate("tags", "name displayName");
    const populated = video;

    startVideoProcessingJob({
      videoId: video._id.toString(),
      localInputPath: uploadedVideoFile.path,
      originalName: uploadedVideoFile.originalname,
      title,
    });
    workerStarted = true;

    videoDebugLog("Create processed video accepted", {
      videoId: video._id.toString(),
      processingStatus: "processing",
      videoTempPath: uploadedVideoFile.path,
    });
    return res.status(200).json(populated);
  } catch (error) {
    if (uploadedThumbKey) {
      try {
        await deleteFileFromR2(uploadedThumbKey);
      } catch (_deleteError) {
        // ignore cleanup failure
      }
    }
    if (!workerStarted && uploadedVideoFile?.path) {
      fs.rmSync(uploadedVideoFile.path, { force: true });
      videoDebugLog("Removed temp video file after pre-worker failure", { tempPath: uploadedVideoFile.path });
    }
    videoDebugLog("Create processed video failed", { error: error.message });
    return res.status(500).json({ error: `Video processing failed: ${error.message}` });
  } finally {
    if (uploadedThumbnailFile?.path) {
      fs.rmSync(uploadedThumbnailFile.path, { force: true });
      videoDebugLog("Removed temp thumbnail file", { tempPath: uploadedThumbnailFile.path });
    }
  }
};

const getVideoById = async (req, res) => {
  const { id } = req.params;
  videoDebugLog("Get video by id request", { id });

  const userIdentifier = typeof req.query.userIdentifier === "string" ? req.query.userIdentifier.trim() : "";
  const video = await Video.findOne(resolveVideoFilter(id)).populate("category", "name imageUrl").populate("tags", "name displayName");
  if (!video) {
    videoDebugLog("Get video by id failed: not found", { id });
    return res.status(404).json({ error: "Video not found" });
  }
  const enhanced = await attachEngagementData(video, userIdentifier);
  let recommendedVideos = [];
  if (Array.isArray(video.tags) && video.tags.length) {
    recommendedVideos = await Video.find({
      _id: { $ne: video._id },
      tags: { $in: video.tags.map((tag) => tag._id || tag) },
      processingStatus: { $in: ["public", "active", "ready"] },
    })
      .populate("category", "name imageUrl")
      .populate("tags", "name displayName")
      .sort({ viewsCount: -1, createdAt: -1 })
      .limit(12);
  }
  enhanced.recommendedVideos = withMediaProxyUrlsList(recommendedVideos, req);
  videoDebugLog("Get video by id success", { id });
  return res.json(withMediaProxyUrls(enhanced, req));
};

const updateVideo = async (req, res) => {
  const { id } = req.params;
  const { title, description, thumbnail, videoUrl, categoryId, status, slug, tags } = req.body;
  const uploadedThumbnailFile = req.files?.thumbnailImage?.[0];
  videoDebugLog("Update video request", {
    id,
    hasTitle: title !== undefined,
    hasDescription: description !== undefined,
    hasThumbnailUrl: thumbnail !== undefined,
    hasVideoUrl: videoUrl !== undefined,
    categoryId,
    status,
    hasThumbnailFile: Boolean(uploadedThumbnailFile),
  });

  if (categoryId) {
    const category = await Category.findOne(resolveCategoryFilter(categoryId)).select("_id");
    if (!category) {
      videoDebugLog("Update video failed: category not found", { categoryId });
      return res.status(404).json({ error: "Category not found" });
    }
  }

  try {
    const existing = await Video.findOne(resolveVideoFilter(id));
    if (!existing) {
      videoDebugLog("Update video failed: video not found", { id });
      return res.status(404).json({ error: "Video not found" });
    }
    const resolvedCategory = categoryId ? await Category.findOne(resolveCategoryFilter(categoryId)).select("_id") : null;
    const nextVideoTitle = (title || existing.title || "").trim();
    const shouldRegenerateSlug = slug !== undefined || (title !== undefined && nextVideoTitle !== existing.title);
    const nextSlug = shouldRegenerateSlug
      ? await buildUniqueSlug({
          source: nextVideoTitle,
          providedSlug: slug,
          exists: async (candidate) => Boolean(await Video.exists({ slug: candidate, _id: { $ne: existing._id } })),
        })
      : existing.slug;

    const uploadedThumb = await uploadThumbnailIfPresent(uploadedThumbnailFile);
    const existingThumbnailKey = existing.thumbnailKey || extractObjectKeyFromUrl(existing.thumbnail);
    if (uploadedThumb?.key && existingThumbnailKey) {
      try {
        await deleteFileFromR2(existingThumbnailKey);
      } catch (error) {
        videoDebugLog("Failed deleting old thumbnail from R2", { id, error: error.message });
      }
    }

    const updateDoc = {
      ...(title !== undefined ? { title } : {}),
      ...(nextSlug ? { slug: nextSlug } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(thumbnail !== undefined ? { thumbnail } : {}),
      ...(uploadedThumb?.url ? { thumbnail: uploadedThumb.url } : {}),
      ...(uploadedThumb?.key ? { thumbnailKey: uploadedThumb.key } : {}),
      ...(videoUrl !== undefined ? { videoUrl } : {}),
      ...(resolvedCategory?._id ? { category: resolvedCategory._id } : {}),
      ...(status !== undefined && FINAL_VIDEO_STATUSES.includes(status)
        ? { processingStatus: normalizeFinalStatus(status), finalStatus: normalizeFinalStatus(status) }
        : {}),
    };
    if (tags !== undefined) {
      const tagIds = await resolveTags(resolveIncomingTags(req.body));
      updateDoc.tags = tagIds;
    }

    const updated = await Video.findByIdAndUpdate(existing._id, { $set: updateDoc }, { returnDocument: "after" })
      .populate("category", "name imageUrl")
      .populate("tags", "name displayName");

    if (!updated) {
      videoDebugLog("Update video failed: video not found", { id });
      return res.status(404).json({ error: "Video not found" });
    }
    videoDebugLog("Update video success", { id });
    return res.json(updated);
  } finally {
    if (uploadedThumbnailFile?.path) {
      fs.rmSync(uploadedThumbnailFile.path, { force: true });
    }
  }
};

const deleteVideo = async (req, res) => {
  const { id } = req.params;
  videoDebugLog("Delete video request", { id });
  const existing = await Video.findOne(resolveVideoFilter(id));
  if (!existing) {
    videoDebugLog("Delete video failed: not found", { id });
    return res.status(404).json({ error: "Video not found" });
  }
  if (existing.processingStatus === "processing") {
    cancelVideoProcessingJob(existing._id.toString());
  }

  const deleted = await Video.findByIdAndDelete(existing._id);
  if (!deleted) {
    videoDebugLog("Delete video failed: concurrent delete", { id });
    return res.status(404).json({ error: "Video not found" });
  }
  const keysToDelete = [];
  const sourceVideoKey = deleted.sourceVideoKey || extractObjectKeyFromUrl(deleted.videoUrl);
  if (sourceVideoKey) {
    keysToDelete.push(sourceVideoKey);
  }
  const thumbnailKey = deleted.thumbnailKey || extractObjectKeyFromUrl(deleted.thumbnail);
  if (thumbnailKey) {
    keysToDelete.push(thumbnailKey);
  }
  if (Array.isArray(deleted.qualityVariants)) {
    for (const variant of deleted.qualityVariants) {
      const variantKey = variant?.key || extractObjectKeyFromUrl(variant?.url);
      if (variantKey) {
        keysToDelete.push(variantKey);
      }
    }
  }
  if (Array.isArray(deleted.hlsKeys)) {
    for (const key of deleted.hlsKeys) {
      if (key) {
        keysToDelete.push(key);
      }
    }
  }

  for (const key of keysToDelete) {
    try {
      await deleteFileFromR2(key);
    } catch (error) {
      videoDebugLog("Failed deleting video media from R2", { id, key, error: error.message });
    }
  }

  videoDebugLog("Delete video success", { id });
  return res.status(204).send();
};

const trackVideoView = async (req, res) => {
  const { id } = req.params;
  const { userIdentifier, watchedSeconds } = req.body;

  if (!userIdentifier || typeof userIdentifier !== "string") {
    return res.status(400).json({ error: "userIdentifier is required" });
  }
  if (Number(watchedSeconds) < 5) {
    return res.status(200).json({ counted: false, reason: "minimum_5_seconds_required" });
  }

  const video = await Video.findOne(resolveVideoFilter(id));
  if (!video) {
    return res.status(404).json({ error: "Video not found" });
  }

  const updated = await Video.findByIdAndUpdate(video._id, { $inc: { viewsCount: 1 } }, { returnDocument: "after" });
  return res.status(200).json({ counted: true, viewsCount: updated?.viewsCount || video.viewsCount });
};

const getVideoComments = async (req, res) => {
  const { id } = req.params;
  const video = await Video.findOne(resolveVideoFilter(id)).select("_id");
  if (!video) return res.status(404).json({ error: "Video not found" });
  const comments = await VideoComment.find({ video: video._id, isActive: true }).sort({ createdAt: -1 }).limit(200);
  return res.json(comments);
};

const addVideoComment = async (req, res) => {
  const { id } = req.params;
  const { userIdentifier, authorName, message } = req.body;
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "message is required" });
  }
  const video = await Video.findOne(resolveVideoFilter(id));
  if (!video) {
    return res.status(404).json({ error: "Video not found" });
  }
  const comment = await VideoComment.create({
    video: video._id,
    userIdentifier: typeof userIdentifier === "string" ? userIdentifier.trim() : "",
    authorName: typeof authorName === "string" && authorName.trim() ? authorName.trim() : "User",
    message: message.trim(),
  });
  return res.status(201).json(comment);
};

const reactToVideo = async (req, res) => {
  const { id } = req.params;
  const { userIdentifier, reaction } = req.body;
  if (!["like", "dislike"].includes(reaction)) {
    return res.status(400).json({ error: "reaction must be like or dislike" });
  }
  if (!userIdentifier || typeof userIdentifier !== "string") {
    return res.status(400).json({ error: "userIdentifier is required" });
  }
  const video = await Video.findOne(resolveVideoFilter(id));
  if (!video) {
    return res.status(404).json({ error: "Video not found" });
  }
  await VideoReaction.findOneAndUpdate(
    { video: video._id, userIdentifier: userIdentifier.trim() },
    { $set: { reaction } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true }
  );
  const enhanced = await attachEngagementData(video, userIdentifier.trim());
  return res.json({
    likesCount: enhanced.likesCount,
    dislikesCount: enhanced.dislikesCount,
    userReaction: enhanced.userReaction,
  });
};

const addVideoTags = async (req, res) => {
  const { id } = req.params;
  const { tags } = req.body;
  const video = await Video.findOne(resolveVideoFilter(id));
  if (!video) {
    return res.status(404).json({ error: "Video not found" });
  }
  const tagIds = await resolveTags(resolveIncomingTags(req.body));
  const updated = await Video.findByIdAndUpdate(video._id, { $set: { tags: tagIds } }, { returnDocument: "after" }).populate(
    "tags",
    "name displayName"
  );
  return res.json({ tags: updated?.tags || [] });
};

module.exports = {
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
};
