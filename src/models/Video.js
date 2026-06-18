const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    videoId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      match: /^\d{6}$/,
    },
    slug: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    description: { type: String, default: "" },
    thumbnail: { type: String, default: "" },
    thumbnailKey: { type: String, default: "" },
    previewUrl: { type: String, default: "" },
    previewKey: { type: String, default: "" },
    videoUrl: { type: String, required: true },
    sourceVideoKey: { type: String, default: "" },
    hlsKeys: [{ type: String }],
    durationSeconds: { type: Number, default: 0 },
    maxSourceHeight: { type: Number, default: 0 },
    qualityVariants: [
      {
        label: { type: String, required: true },
        height: { type: Number, required: true },
        width: { type: Number, default: 0 },
        url: { type: String, required: true },
        key: { type: String, required: true },
      },
    ],
    processingStatus: {
      type: String,
      enum: ["public", "private", "processing", "draft", "active", "inactive", "ready", "failed"],
      default: "draft",
    },
    finalStatus: {
      type: String,
      enum: ["public", "private", "draft", "active", "inactive"],
      default: "public",
    },
    viewsCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "VideoTag",
      },
    ],
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    storageServer: { type: mongoose.Schema.Types.ObjectId, ref: "StorageServer" },
    healthStatus: {
      type: String,
      enum: ["online", "offline", "processing", "unknown"],
      default: "unknown",
    },
    healthCheckedAt: { type: Date, default: null },
    healthMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

videoSchema.pre("save", async function assignVideoId() {
  if (this.videoId) return;
  const { generateUniqueVideoId } = require("../utils/videoId");
  this.videoId = await generateUniqueVideoId();
});

module.exports = mongoose.model("Video", videoSchema);
