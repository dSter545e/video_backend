const fs = require("fs");
const Video = require("../models/Video");
const { processAndUploadVideoVariants } = require("../services/videoProcessingService");

const videoDebugLog = () => {};
const activeJobs = new Map();

const startVideoProcessingJob = ({ videoId, localInputPath, originalName, title }) => {
  const jobState = { cancelled: false };
  activeJobs.set(videoId, jobState);

  setImmediate(async () => {
    const startedAt = Date.now();
    let stage = "queued";
    const metrics = {
      original: {
        percent: 0,
        uploadedMB: 0,
        totalMB: 0,
        speedMBps: 0,
        etaSec: null,
        waitingR2Ack: false,
      },
      variants: {
        total: 0,
        completed: 0,
        current: null,
      },
    };
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
      videoDebugLog("Processing heartbeat", {
        videoId,
        stage,
        elapsedSec,
        cancelled: jobState.cancelled,
        originalUpload: metrics.original,
        variants: metrics.variants,
      });
    }, 10000);
    try {
      videoDebugLog("Background processing started", { videoId, localInputPath });
      if (jobState.cancelled) {
        throw new Error("VIDEO_PROCESS_CANCELLED");
      }

      stage = "processing_variants";
      videoDebugLog("Starting variant generation", { videoId });
      const processed = await processAndUploadVideoVariants({
        localInputPath,
        originalName,
        title,
        shouldAbort: () => jobState.cancelled,
        onVariantPlan: (plan) => {
          metrics.variants.total = plan.total;
          videoDebugLog("Variant plan ready", {
            videoId,
            totalVariants: plan.total,
            heights: plan.heights,
          });
        },
        onVariantStart: (variant) => {
          metrics.variants.current = variant.label;
          videoDebugLog("Variant transcode started", {
            videoId,
            variant: variant.label,
          });
        },
        onVariantTranscoded: (variant) => {
          videoDebugLog("Variant transcode complete", {
            videoId,
            variant: variant.label,
            elapsedSec: variant.elapsedSec,
            sizeMB: variant.sizeMB,
          });
        },
        onVariantProgress: (progress) => {
          videoDebugLog("Variant upload progress", {
            videoId,
            variant: progress.label,
            percent: progress.percent,
            uploadedMB: progress.uploadedMB,
            totalMB: progress.totalMB,
            speedMBps: progress.speedMBps,
            etaSec: progress.etaSec,
          });
        },
        onVariantUploaded: (variant) => {
          metrics.variants.completed += 1;
          metrics.variants.current = variant.label;
          videoDebugLog("Variant upload complete", {
            videoId,
            variant: variant.label,
            uploadedCount: metrics.variants.completed,
          });
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

      stage = "completed";
      videoDebugLog("Background processing finished", {
        videoId,
        variantCount: processed.variants?.length || 0,
        maxSourceHeight: processed.maxSourceHeight,
        finalStatus: nextStatus,
      });
    } catch (error) {
      stage = "failed";
      if (error.message === "VIDEO_PROCESS_CANCELLED") {
        videoDebugLog("Background processing cancelled", { videoId });
      }
      await Video.findByIdAndUpdate(videoId, {
        $set: {
          processingStatus: "private",
        },
      });
      videoDebugLog("Background processing failed", { videoId, error: error.message, stack: error.stack });
    } finally {
      clearInterval(heartbeat);
      activeJobs.delete(videoId);
      if (localInputPath) {
        fs.rmSync(localInputPath, { force: true });
        videoDebugLog("Removed temp source video file", { videoId, localInputPath });
      }
    }
  });
};

const cancelVideoProcessingJob = (videoId) => {
  const job = activeJobs.get(videoId);
  if (job) {
    job.cancelled = true;
    videoDebugLog("Cancellation requested for processing job", { videoId });
  }
};

module.exports = { startVideoProcessingJob, cancelVideoProcessingJob };
