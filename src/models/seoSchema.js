const seoSchemaDefinition = {
  metaTitle: { type: String, default: "", trim: true, maxlength: 70 },
  metaDescription: { type: String, default: "", trim: true, maxlength: 160 },
  metaKeywords: { type: String, default: "", trim: true, maxlength: 255 },
  ogTitle: { type: String, default: "", trim: true, maxlength: 70 },
  ogDescription: { type: String, default: "", trim: true, maxlength: 200 },
  ogImage: { type: String, default: "", trim: true },
  ogImageKey: { type: String, default: "", trim: true },
  noindex: { type: Boolean, default: false },
};

module.exports = { seoSchemaDefinition };
