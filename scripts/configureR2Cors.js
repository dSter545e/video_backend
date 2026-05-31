require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const connectDB = require("../src/config/db");
const { configureAllR2Cors, getDefaultCorsOrigins } = require("../src/utils/r2Client");

const main = async () => {
  await connectDB();
  const origins = getDefaultCorsOrigins();
  const results = await configureAllR2Cors(origins);

  for (const result of results) {
    console.log(`[R2] CORS configured for "${result.name}" (bucket: ${result.bucket})`);
  }
  console.log("[R2] Allowed origins:", origins.join(", "));
};

main().catch((error) => {
  console.error("[R2] Failed to configure CORS:", error.message);
  process.exit(1);
});
