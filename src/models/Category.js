const mongoose = require("mongoose");
const { seoSchemaDefinition } = require("./seoSchema");

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    slug: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
    imageUrl: { type: String, default: "" },
    imageKey: { type: String, default: "" },
    featured: { type: Boolean, default: false },
    seo: seoSchemaDefinition,
  },
  { timestamps: true }
);

module.exports = mongoose.model("Category", categorySchema);
