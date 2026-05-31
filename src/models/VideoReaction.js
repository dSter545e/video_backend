const mongoose = require("mongoose");

const videoReactionSchema = new mongoose.Schema(
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
    reaction: {
      type: String,
      enum: ["like", "dislike"],
      required: true,
    },
  },
  { timestamps: true }
);

videoReactionSchema.index({ video: 1, userIdentifier: 1 }, { unique: true });

module.exports = mongoose.model("VideoReaction", videoReactionSchema);
