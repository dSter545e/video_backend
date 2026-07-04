const parseBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
  }
  return Boolean(value);
};

const normalizeSeoValue = (value, maxLength) => {
  if (value === undefined) return undefined;
  return String(value || "").trim().slice(0, maxLength);
};

const buildSeoDocument = (body = {}) => ({
  metaTitle: normalizeSeoValue(body.metaTitle, 70) || "",
  metaDescription: normalizeSeoValue(body.metaDescription, 160) || "",
  metaKeywords: normalizeSeoValue(body.metaKeywords, 255) || "",
  ogTitle: normalizeSeoValue(body.ogTitle, 70) || "",
  ogDescription: normalizeSeoValue(body.ogDescription, 200) || "",
  ogImage: normalizeSeoValue(body.ogImage, 2048) || "",
  noindex: parseBoolean(body.noindex),
});

const buildSeoUpdateFields = (body = {}) => {
  const update = {};
  if (body.metaTitle !== undefined) update["seo.metaTitle"] = normalizeSeoValue(body.metaTitle, 70) || "";
  if (body.metaDescription !== undefined) {
    update["seo.metaDescription"] = normalizeSeoValue(body.metaDescription, 160) || "";
  }
  if (body.metaKeywords !== undefined) update["seo.metaKeywords"] = normalizeSeoValue(body.metaKeywords, 255) || "";
  if (body.ogTitle !== undefined) update["seo.ogTitle"] = normalizeSeoValue(body.ogTitle, 70) || "";
  if (body.ogDescription !== undefined) update["seo.ogDescription"] = normalizeSeoValue(body.ogDescription, 200) || "";
  if (body.ogImage !== undefined) update["seo.ogImage"] = normalizeSeoValue(body.ogImage, 2048) || "";
  if (body.noindex !== undefined) update["seo.noindex"] = parseBoolean(body.noindex);
  return update;
};

const applyUploadedOgImage = (updateDoc, uploaded, existingSeo = {}) => {
  if (!uploaded?.url) return updateDoc;
  updateDoc["seo.ogImage"] = uploaded.url;
  updateDoc["seo.ogImageKey"] = uploaded.key || "";
  return updateDoc;
};

module.exports = {
  parseBoolean,
  buildSeoDocument,
  buildSeoUpdateFields,
  applyUploadedOgImage,
};
