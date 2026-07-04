const mongoose = require("mongoose");
const { seoSchemaDefinition } = require("./seoSchema");

const pageSchema = new mongoose.Schema(
  {
    systemKey: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    isSystem: { type: Boolean, default: false },
    pageKind: { type: String, enum: ["content", "meta-only"], default: "content" },
    title: { type: String, required: true, trim: true },
    slug: { type: String, unique: true, required: true, trim: true, lowercase: true },
    path: { type: String, default: "", trim: true },
    content: { type: String, default: "" },
    status: { type: String, enum: ["published", "draft"], default: "draft" },
    seo: seoSchemaDefinition,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Page", pageSchema);
