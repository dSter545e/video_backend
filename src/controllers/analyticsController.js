const VisitorSession = require("../models/VisitorSession");
const VisitorEvent = require("../models/VisitorEvent");
const Video = require("../models/Video");
const Category = require("../models/Category");

const getRequestClientData = (req) => ({
  userAgent: req.headers["user-agent"] || "",
});

const startSession = async (req, res) => {
  const { visitorId, sessionId, path = "", url = "", referrer = "", timezone = "", language = "", screen = {} } = req.body || {};
  if (!visitorId || !sessionId) {
    return res.status(400).json({ error: "visitorId and sessionId are required" });
  }

  const clientData = getRequestClientData(req);
  await VisitorSession.findOneAndUpdate(
    { sessionId },
    {
      $setOnInsert: {
        visitorId,
        sessionId,
        startedAt: new Date(),
        initialPath: path,
        firstReferrer: referrer,
        firstUserAgent: clientData.userAgent,
        timezone,
        language,
        screen: {
          width: Number(screen?.width) || 0,
          height: Number(screen?.height) || 0,
        },
      },
      $set: {
        lastSeenAt: new Date(),
        lastPath: path,
        status: "active",
      },
      $inc: { pageViews: 1 },
    },
    { upsert: true, returnDocument: "after" }
  );

  await VisitorEvent.create({
    visitorId,
    sessionId,
    eventType: "session_start",
    path,
    url,
    referrer,
    userAgent: clientData.userAgent,
    occurredAt: new Date(),
  });

  return res.status(201).json({ ok: true });
};

const logEvent = async (req, res) => {
  const { visitorId, sessionId, eventType, path = "", url = "", referrer = "", tabCount = 1, activeSeconds = 0, metadata = {} } = req.body || {};
  if (!visitorId || !sessionId || !eventType) {
    return res.status(400).json({ error: "visitorId, sessionId and eventType are required" });
  }
  const clientData = getRequestClientData(req);
  const now = new Date();

  await VisitorEvent.create({
    visitorId,
    sessionId,
    eventType,
    path,
    url,
    referrer,
    userAgent: clientData.userAgent,
    tabCount: Math.max(1, Number(tabCount) || 1),
    activeSeconds: Math.max(0, Number(activeSeconds) || 0),
    metadata,
    occurredAt: now,
  });

  await VisitorSession.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        lastSeenAt: now,
        lastPath: path,
      },
      $max: { maxTabCount: Math.max(1, Number(tabCount) || 1) },
      $inc: { totalActiveSeconds: Math.max(0, Number(activeSeconds) || 0) },
    }
  );

  return res.status(201).json({ ok: true });
};

const endSession = async (req, res) => {
  const { visitorId, sessionId, path = "", reason = "leave", activeSeconds = 0, tabCount = 1 } = req.body || {};
  if (!visitorId || !sessionId) {
    return res.status(400).json({ error: "visitorId and sessionId are required" });
  }
  const now = new Date();
  const clientData = getRequestClientData(req);

  await VisitorSession.findOneAndUpdate(
    { sessionId },
    {
      $set: {
        endedAt: now,
        lastSeenAt: now,
        lastPath: path,
        status: "ended",
      },
      $max: { maxTabCount: Math.max(1, Number(tabCount) || 1) },
      $inc: { totalActiveSeconds: Math.max(0, Number(activeSeconds) || 0) },
    }
  );

  await VisitorEvent.create({
    visitorId,
    sessionId,
    eventType: "session_end",
    path,
    userAgent: clientData.userAgent,
    tabCount: Math.max(1, Number(tabCount) || 1),
    activeSeconds: Math.max(0, Number(activeSeconds) || 0),
    metadata: { reason },
    occurredAt: now,
  });

  return res.status(200).json({ ok: true });
};

const getAdminSummary = async (_req, res) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dailyStart = new Date(startOfToday);
  dailyStart.setDate(dailyStart.getDate() - 29);
  const monthlyStart = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const recent7DaysStart = new Date(startOfToday);
  recent7DaysStart.setDate(recent7DaysStart.getDate() - 6);

  const [dailyRows, monthlyRows, categoryRows, topPageRows, eventRows, hourlyRows, deviceRows, watchTrendRows, sessionSummary, referrerRows] =
    await Promise.all([
    VisitorEvent.aggregate([
      { $match: { occurredAt: { $gte: dailyStart }, eventType: { $in: ["page_view", "session_start", "heartbeat"] } } },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } },
            visitorId: "$visitorId",
          },
        },
      },
      { $group: { _id: "$_id.date", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    VisitorEvent.aggregate([
      { $match: { occurredAt: { $gte: monthlyStart }, eventType: { $in: ["page_view", "session_start", "heartbeat"] } } },
      {
        $group: {
          _id: {
            month: { $dateToString: { format: "%Y-%m", date: "$occurredAt" } },
            visitorId: "$visitorId",
          },
        },
      },
      { $group: { _id: "$_id.month", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Video.aggregate([
      {
        $group: {
          _id: "$category",
          totalViews: { $sum: { $ifNull: ["$viewsCount", 0] } },
          totalVideos: { $sum: 1 },
        },
      },
      { $sort: { totalViews: -1 } },
      { $limit: 10 },
    ]),
    VisitorEvent.aggregate([
      { $match: { occurredAt: { $gte: dailyStart }, eventType: "page_view", path: { $ne: "" } } },
      { $group: { _id: "$path", views: { $sum: 1 } } },
      { $sort: { views: -1 } },
      { $limit: 10 },
    ]),
    VisitorEvent.aggregate([
      { $match: { occurredAt: { $gte: dailyStart } } },
      { $group: { _id: "$eventType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    VisitorEvent.aggregate([
      { $match: { occurredAt: { $gte: recent7DaysStart } } },
      { $group: { _id: { $hour: "$occurredAt" }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    VisitorSession.aggregate([
      { $match: { startedAt: { $gte: dailyStart } } },
      {
        $project: {
          deviceType: {
            $switch: {
              branches: [
                { case: { $regexMatch: { input: "$firstUserAgent", regex: /mobile/i } }, then: "mobile" },
                { case: { $regexMatch: { input: "$firstUserAgent", regex: /tablet|ipad/i } }, then: "tablet" },
              ],
              default: "desktop",
            },
          },
        },
      },
      { $group: { _id: "$deviceType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    VisitorEvent.aggregate([
      { $match: { occurredAt: { $gte: dailyStart }, eventType: "video_watch_progress" } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    VisitorSession.aggregate([
      { $match: { startedAt: { $gte: dailyStart } } },
      {
        $group: {
          _id: null,
          totalSessions: { $sum: 1 },
          totalPageViews: { $sum: { $ifNull: ["$pageViews", 0] } },
          totalActiveSeconds: { $sum: { $ifNull: ["$totalActiveSeconds", 0] } },
          bounceSessions: {
            $sum: {
              $cond: [{ $lte: [{ $ifNull: ["$pageViews", 0] }, 1] }, 1, 0],
            },
          },
        },
      },
    ]),
    VisitorSession.aggregate([
      { $match: { startedAt: { $gte: dailyStart } } },
      { $group: { _id: "$firstReferrer", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    ]);

  const categories = await Category.find({
    _id: { $in: categoryRows.map((row) => row._id).filter(Boolean) },
  }).select("_id name slug");
  const categoryMap = new Map(categories.map((category) => [category._id.toString(), category]));

  const dau = dailyRows.length ? dailyRows[dailyRows.length - 1].count : 0;
  const mau = monthlyRows.length ? monthlyRows[monthlyRows.length - 1].count : 0;
  const totals = sessionSummary[0] || {
    totalSessions: 0,
    totalPageViews: 0,
    totalActiveSeconds: 0,
    bounceSessions: 0,
  };
  const totalEventsLast30Days = eventRows.reduce((sum, row) => sum + (row.count || 0), 0);

  const parsedReferrers = referrerRows
    .map((row) => {
      const raw = String(row._id || "").trim();
      if (!raw) return { source: "direct", count: row.count || 0 };
      try {
        const host = new URL(raw).hostname.replace(/^www\./i, "");
        return { source: host || "direct", count: row.count || 0 };
      } catch (_error) {
        return { source: "unknown", count: row.count || 0 };
      }
    })
    .reduce((acc, item) => {
      const existing = acc.get(item.source) || 0;
      acc.set(item.source, existing + item.count);
      return acc;
    }, new Map());

  const referrerBreakdown = Array.from(parsedReferrers.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return res.json({
    dau,
    mau,
    totalSessionsLast30Days: totals.totalSessions || 0,
    totalPageViewsLast30Days: totals.totalPageViews || 0,
    totalEventsLast30Days,
    avgSessionDurationSeconds: totals.totalSessions ? Math.round((totals.totalActiveSeconds || 0) / totals.totalSessions) : 0,
    bounceRatePercent: totals.totalSessions ? Math.round(((totals.bounceSessions || 0) / totals.totalSessions) * 100) : 0,
    dailyActiveTrend: dailyRows.map((row) => ({ date: row._id, count: row.count })),
    monthlyActiveTrend: monthlyRows.map((row) => ({ month: row._id, count: row.count })),
    videoWatchTrend: watchTrendRows.map((row) => ({ date: row._id, count: row.count })),
    popularCategories: categoryRows.map((row) => {
      const category = categoryMap.get(String(row._id));
      return {
        categoryId: String(row._id || ""),
        name: category?.name || "Unknown Category",
        slug: category?.slug || "",
        totalViews: row.totalViews || 0,
        totalVideos: row.totalVideos || 0,
      };
    }),
    topPages: topPageRows.map((row) => ({ path: row._id, views: row.views || 0 })),
    eventBreakdown: eventRows.map((row) => ({ eventType: row._id, count: row.count || 0 })),
    hourlyActivity: hourlyRows.map((row) => ({ hour: Number(row._id), count: row.count || 0 })),
    deviceBreakdown: deviceRows.map((row) => ({ deviceType: row._id, count: row.count || 0 })),
    referrerBreakdown,
    generatedAt: now.toISOString(),
  });
};

module.exports = {
  startSession,
  logEvent,
  endSession,
  getAdminSummary,
};
