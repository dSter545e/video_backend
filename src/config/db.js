const mongoose = require("mongoose");

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error("MONGO_URI is required in environment variables");
  }

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected");

  const { backfillMissingVideoIds } = require("../utils/videoId");
  await backfillMissingVideoIds();
};

module.exports = connectDB;
