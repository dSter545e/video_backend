const Video = require("../models/Video");
const Category = require("../models/Category");

const getDashboardStats = async (_req, res) => {
  const [videos, categories] = await Promise.all([Video.countDocuments(), Category.countDocuments()]);
  return res.json({
    totalVideos: videos,
    totalCategories: categories,
  });
};

module.exports = { getDashboardStats };
