const { verifyAdminToken, verifyUserToken } = require("../utils/jwt");
const Admin = require("../models/Admin");
const User = require("../models/User");

const adminAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = verifyAdminToken(token);
    const adminId = decoded.adminId;
    if (!adminId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const admin = await Admin.findOne({ _id: adminId, isActive: true }).select("_id email role name");
    if (!admin) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.admin = {
      adminId: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      name: admin.name,
    };
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

const userAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const decoded = verifyUserToken(token);
    const userId = decoded.userId;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const user = await User.findOne({ _id: userId, isActive: true }).select("_id email name");
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = {
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
    };
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid token" });
  }
};

module.exports = { adminAuth, userAuth };
