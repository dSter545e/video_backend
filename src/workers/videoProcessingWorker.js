const fs = require("fs");
const Video = require("../models/Video");
const { processAndUploadVideoVariants } = require("../services/videoProcessingService");

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

      const currentVideo = await Video.findById(videoId).select("finalStatus");
      if (jobState.cancelled || !currentVideo) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }
      const nextStatus = currentVideo?.finalStatus === "active" ? "public" : currentVideo?.finalStatus || "public";

      await Video.findByIdAndUpdate(videoId, {
        $set: {
          videoUrl: processed.masterUrl,
          sourceVideoKey: processed.masterKey || "",
          hlsKeys: processed.hlsKeys || [],
          qualityVariants: processed.variants,
          maxSourceHeight: processed.maxSourceHeight,
          durationSeconds: processed.durationSeconds,
          processingStatus: nextStatus,
        },
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
