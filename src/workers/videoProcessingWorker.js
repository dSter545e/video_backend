const fs = require("fs");
const Video = require("../models/Video");
const {
  processAndUploadVideoVariants,
  extractAndUploadThumbnailFromVideo,
} = require("../services/videoProcessingService");

const hasCustomThumbnail = (value) => {
  const url = typeof value === "string" ? value.trim() : "";
  return Boolean(url && url !== "about:blank");
};

const activeJobs = new Map();

const startVideoProcessingJob = ({ videoId, localInputPath, originalName, title, serverConfig }) => {
  const jobState = { cancelled: false };
  activeJobs.set(videoId, jobState);

  setImmediate(async () => {
    const metrics = {
      variants: {
        total: 0,
        completed: 0,
        current: null,
      },
    };

    try {
      if (jobState.cancelled) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }

      const currentVideo = await Video.findById(videoId).select("thumbnail finalStatus");
      if (!currentVideo) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }
      const shouldGenerateThumbnail = !hasCustomThumbnail(currentVideo.thumbnail);

      const processed = await processAndUploadVideoVariants({
        localInputPath,
        originalName,
        title,
        serverConfig,
        shouldAbort: () => jobState.cancelled,
        onVariantPlan: (plan) => {
          metrics.variants.total = plan.total;
        },
        onVariantStart: (variant) => {
          metrics.variants.current = variant.label;
        },
        onVariantTranscoded: () => {},
        onVariantProgress: () => {},
        onVariantUploaded: (variant) => {
          metrics.variants.completed += 1;
          metrics.variants.current = variant.label;
        },
      });

      if (jobState.cancelled) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }
      const nextStatus = currentVideo.finalStatus === "active" ? "public" : currentVideo.finalStatus || "public";

      const updateFields = {
        videoUrl: processed.masterUrl,
        sourceVideoKey: processed.masterKey || "",
        hlsKeys: processed.hlsKeys || [],
        qualityVariants: processed.variants,
        maxSourceHeight: processed.maxSourceHeight,
        durationSeconds: processed.durationSeconds,
        processingStatus: nextStatus,
      };

      if (shouldGenerateThumbnail) {
        try {
          const autoThumb = await extractAndUploadThumbnailFromVideo({
            localInputPath,
            title,
            serverConfig,
          });
          if (autoThumb?.url) {
            updateFields.thumbnail = autoThumb.url;
            updateFields.thumbnailKey = autoThumb.key || "";
          }
        } catch (_thumbError) {
          // Video can still publish without a thumbnail; frontend may use video poster fallback.
        }
      }

      await Video.findByIdAndUpdate(videoId, {
        $set: updateFields,
      });
    } catch (error) {
      if (error.message !== "VIDEO_PROCESS_CANCELLED") {
        await Video.findByIdAndUpdate(videoId, {
          $set: {
            processingStatus: "private",
          },
        });
      }
    } finally {
      activeJobs.delete(videoId);
      if (localInputPath) {
        fs.rmSync(localInputPath, { force: true });
      }
    }
  });
};

const cancelVideoProcessingJob = (videoId) => {
  const job = activeJobs.get(videoId);
  if (job) {
    job.cancelled = true;
  }
};

module.exports = { startVideoProcessingJob, cancelVideoProcessingJob };
