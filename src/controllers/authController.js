const bcrypt = require("bcryptjs");
const { signAdminToken } = require("../utils/jwt");
const Admin = require("../models/Admin");

const authDebugLog = () => {};

const loginAdmin = async (req, res) => {
  const { email, password } = req.body;
  authDebugLog("Login attempt received", { emailProvided: Boolean(email), passwordProvided: Boolean(password), email });

  if (!email || !password) {
    authDebugLog("Rejected login: missing email or password");
    return res.status(400).json({ error: "email and password are required" });
  }

  const admin = await Admin.findOne({ email: email.toLowerCase(), isActive: true });
  if (!admin) {
    authDebugLog("Rejected login: admin not found or inactive", { email: email.toLowerCase() });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const validPassword = await bcrypt.compare(password, admin.passwordHash);
  if (!validPassword) {
    authDebugLog("Rejected login: password mismatch", { adminId: admin._id.toString(), email: admin.email });
    return res.status(401).json({ error: "Invalid credentials" });
  }

  authDebugLog("Login success", { adminId: admin._id.toString(), email: admin.email, role: admin.role });
  const token = signAdminToken({ role: admin.role, email: admin.email, adminId: admin._id.toString() });
  return res.json({
    token,
    admin: {
      id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  });
};

const getCurrentAdmin = async (req, res) => {
  const adminId = req.admin?.adminId;
  if (!adminId) {
    authDebugLog("Rejected /me request: missing adminId in token payload");
    return res.status(401).json({ error: "Unauthorized" });
  }

  const admin = await Admin.findOne({ _id: adminId, isActive: true }).select("-passwordHash");
  if (!admin) {
    authDebugLog("Rejected /me request: admin not found", { adminId });
    return res.status(401).json({ error: "Unauthorized" });
  }

  authDebugLog("/me success", { adminId: admin._id.toString(), email: admin.email });
  return res.json({ admin });
};

module.exports = { loginAdmin, getCurrentAdmin };
