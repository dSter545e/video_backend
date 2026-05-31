const { slugify: transliterateToSlug } = require("transliteration");

const normalizeSlugSource = (value = "") =>
  String(value)
    .trim()
    .replace(/\s+/g, " ");

const toUrlSlug = (value = "") => {
  const source = normalizeSlugSource(value);
  if (!source) return "";
  const slug = transliterateToSlug(source, {
    lowercase: true,
    separator: "-",
    trim: true,
  })
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
};

const buildUniqueSlug = async ({ source, providedSlug, exists }) => {
  const base = toUrlSlug(providedSlug || source) || "item";
  let candidate = base;
  let attempt = 1;
  while (await exists(candidate)) {
    candidate = `${base}-${attempt}`;
    attempt += 1;
  }
  return candidate;
};

module.exports = {
  toUrlSlug,
  buildUniqueSlug,
};
