const mongoose = require("mongoose");

const visitorSessionSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, index: true, trim: true },
    sessionId: { type: String, required: true, unique: true, trim: true, index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    endedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    totalActiveSeconds: { type: Number, default: 0, min: 0 },
    pageViews: { type: Number, default: 0, min: 0 },
    maxTabCount: { type: Number, default: 1, min: 1 },
    initialPath: { type: String, default: "" },
    lastPath: { type: String, default: "" },
    firstReferrer: { type: String, default: "" },
    firstUserAgent: { type: String, default: "" },
    timezone: { type: String, default: "" },
    language: { type: String, default: "" },
    screen: {
      width: { type: Number, default: 0 },
      height: { type: Number, default: 0 },
    },
    status: { type: String, enum: ["active", "ended"], default: "active", index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VisitorSession", visitorSessionSchema);
