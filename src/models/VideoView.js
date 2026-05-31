const mongoose = require("mongoose");

const videoViewSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
      index: true,
    },
    userIdentifier: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

videoViewSchema.index({ video: 1, userIdentifier: 1 }, { unique: true });

module.exports = mongoose.model("VideoView", videoViewSchema);
