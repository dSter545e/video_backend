const Page = require("../models/Page");
const { SYSTEM_PAGES } = require("../config/systemPages");
const { getSeoSettings } = require("./seoService");

const ensureSystemPages = async () => {
  for (const definition of SYSTEM_PAGES) {
    const existing = await Page.findOne({
      $or: [{ systemKey: definition.systemKey }, { slug: definition.slug }],
    });

    if (!existing) {
      await Page.create({
        systemKey: definition.systemKey,
        isSystem: true,
        slug: definition.slug,
        path: definition.path,
        title: definition.title,
        pageKind: definition.pageKind,
        content: "",
        status: "published",
        seo: {
          metaTitle: definition.defaultTitle || "",
          metaDescription: definition.defaultDescription || "",
          noindex: Boolean(definition.defaultNoindex),
        },
      });
      continue;
    }

    const seoBackfill = {};
    if (!existing.seo?.metaTitle?.trim() && definition.defaultTitle) {
      seoBackfill["seo.metaTitle"] = definition.defaultTitle;
    }
    if (!existing.seo?.metaDescription?.trim() && definition.defaultDescription) {
      seoBackfill["seo.metaDescription"] = definition.defaultDescription;
    }

    await Page.updateOne(
      { _id: existing._id },
      {
        $set: {
          systemKey: definition.systemKey,
          isSystem: true,
          slug: definition.slug,
          path: definition.path,
          pageKind: definition.pageKind,
          title: existing.title?.trim() ? existing.title : definition.title,
          ...seoBackfill,
        },
      }
    );
  }

  const homePage = await Page.findOne({ systemKey: "home" });
  if (homePage && !homePage.seo?.metaTitle?.trim()) {
    const siteSeo = await getSeoSettings();
    const migratedTitle = siteSeo.defaultTitle?.trim() || SYSTEM_PAGES.find((page) => page.systemKey === "home")?.defaultTitle;
    if (migratedTitle) {
      await Page.updateOne({ _id: homePage._id }, { $set: { "seo.metaTitle": migratedTitle } });
    }
  }

  return Page.find().sort({ isSystem: -1, title: 1 });
};

module.exports = { ensureSystemPages, SYSTEM_PAGES };
