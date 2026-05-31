require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { configureR2Cors, getDefaultCorsOrigins } = require("../src/utils/r2Client");

const main = async () => {
  const origins = getDefaultCorsOrigins();
  const { bucket } = await configureR2Cors(origins);
  console.log(`[R2] CORS configured for bucket "${bucket}"`);
  console.log("[R2] Allowed origins:", origins.join(", "));
};

main().catch((error) => {
  console.error("[R2] Failed to configure CORS:", error.message);
  process.exit(1);
});
