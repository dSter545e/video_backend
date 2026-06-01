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

app.use((error, _req, res, _next) => {
  console.error("Unhandled API error:", error);
  res.status(500).json({ error: "Internal server error" });
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

const listenOnFixedPort = async (port) =>
  new Promise((resolve, reject) => {
    const server = app.listen(port);

    server.once("listening", () => {
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
    console.log(`Server running on http://localhost:${port}`);
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
