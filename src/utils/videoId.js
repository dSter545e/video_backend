const Video = require("../models/Video");

const generateRandomVideoId = () => String(Math.floor(Math.random() * 1000000)).padStart(6, "0");

const generateUniqueVideoId = async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = generateRandomVideoId();
    const exists = await Video.exists({ videoId: candidate });
    if (!exists) return candidate;
  }
  throw new Error("Could not generate unique 6-digit video ID");
};

const backfillMissingVideoIds = async () => {
  const missing = await Video.find({
    $or: [{ videoId: { $exists: false } }, { videoId: null }, { videoId: "" }],
  })
    .select("_id")
    .limit(500);

  if (!missing.length) return;

  for (const video of missing) {
    const videoId = await generateUniqueVideoId();
    await Video.updateOne({ _id: video._id }, { $set: { videoId } });
  }

  console.log(`[VideoId] Backfilled ${missing.length} video(s) with 6-digit IDs`);
};

module.exports = {
  generateUniqueVideoId,
  backfillMissingVideoIds,
};
