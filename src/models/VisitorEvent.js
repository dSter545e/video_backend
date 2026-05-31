const mongoose = require("mongoose");

const visitorEventSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, index: true, trim: true },
    sessionId: { type: String, required: true, index: true, trim: true },
    eventType: { type: String, required: true, index: true, trim: true },
    path: { type: String, default: "", index: true },
    url: { type: String, default: "" },
    referrer: { type: String, default: "" },
    userAgent: { type: String, default: "" },
    tabCount: { type: Number, default: 1, min: 1 },
    activeSeconds: { type: Number, default: 0, min: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VisitorEvent", visitorEventSchema);
