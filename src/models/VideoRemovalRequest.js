const mongoose = require("mongoose");

const videoRemovalRequestSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      default: null,
      index: true,
    },
    videoTitle: {
      type: String,
      default: "",
      trim: true,
    },
    videoReference: {
      type: String,
      default: "",
      trim: true,
    },
    requesterName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    requesterEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    additionalInfo: {
      type: String,
      default: "",
      trim: true,
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    adminNotes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    videoDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VideoRemovalRequest", videoRemovalRequestSchema);
