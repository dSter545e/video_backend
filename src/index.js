const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const { createCorsMiddleware } = require("./config/cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const userAuthRoutes = require("./routes/userAuthRoutes");
const categoryRoutes = require("./routes/categoryRoutes");
const videoRoutes = require("./routes/videoRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const userRoutes = require("./routes/userRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");
const backupRoutes = require("./routes/backupRoutes");
const mediaRoutes = require("./routes/mediaRoutes");
const removalRequestRoutes = require("./routes/removalRequestRoutes");
const storageServerRoutes = require("./routes/storageServerRoutes");
const healthMonitorRoutes = require("./routes/healthMonitorRoutes");
const adRoutes = require("./routes/adRoutes");
const { startAutoBackupScheduler } = require("./services/backupService");
const { startHealthMonitorScheduler } = require("./services/healthMonitorService");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(createCorsMiddleware());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "OTT backend is running" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRoutes);
app.use("/api/user-auth", userAuthRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/videos", videoRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/users", userRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/backups", backupRoutes);
app.use("/api/media", mediaRoutes);
app.use("/api/removal-requests", removalRequestRoutes);
app.use("/api/storage-servers", storageServerRoutes);
app.use("/api/health-monitor", healthMonitorRoutes);
app.use("/api/ads", adRoutes);

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.originalUrl}` });
});

app.use((error, req, res, _next) => {
  console.error("Unhandled API error:", error);
  if (res.headersSent) return;
  if (error?.code === "ECONNABORTED" || error?.message?.includes("aborted")) {
    res.status(408).json({ error: "Upload timed out. Try again or use a faster connection." });
    return;
  }
  res.status(500).json({ error: error?.message || "Internal server error" });
});

const registerProcessErrorHandlers = () => {
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });

  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    process.exit(1);
  });
};

const configureServerForLargeUploads = (server) => {
  // Node 18+ defaults requestTimeout to 5 minutes — large videos need longer.
  const requestTimeoutMs = Number(process.env.UPLOAD_REQUEST_TIMEOUT_MS || 0);
  server.requestTimeout = requestTimeoutMs > 0 ? requestTimeoutMs : 0;
  server.headersTimeout = Number(process.env.UPLOAD_HEADERS_TIMEOUT_MS || 120000);
  server.keepAliveTimeout = Number(process.env.UPLOAD_KEEP_ALIVE_TIMEOUT_MS || 65000);
  server.timeout = Number(process.env.UPLOAD_SOCKET_TIMEOUT_MS || 0);
  server.maxRequestsPerSocket = 0;
};

const listenOnFixedPort = async (port) =>
  new Promise((resolve, reject) => {
    const server = app.listen(port);
    configureServerForLargeUploads(server);

    server.once("listening", () => {
      const uploadLimitMb = process.env.UPLOAD_MAX_FILE_MB || "1024";
      const requestTimeoutLabel =
        server.requestTimeout === 0 ? "disabled" : `${server.requestTimeout}ms`;
      console.log(
        `Upload limits: max file ${uploadLimitMb}MB, request timeout ${requestTimeoutLabel}`
      );
      resolve({ server, port });
    });

    server.once("error", (error) => {
      reject(error);
    });
  });

const start = async () => {
  try {
    registerProcessErrorHandlers();
    await connectDB();
    const preferredPort = Number(PORT);
    const { server, port } = await listenOnFixedPort(preferredPort);
    startAutoBackupScheduler();
    startHealthMonitorScheduler();
    server.on("error", (error) => {
      console.error("Server runtime error:", error);
    });
  } catch (error) {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Stop the running process using port ${PORT} and restart.`);
      process.exit(1);
    }
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

start();
