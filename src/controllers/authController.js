const bcrypt = require("bcryptjs");
const { signAdminToken } = require("../utils/jwt");
const Admin = require("../models/Admin");


const loginAdmin = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const admin = await Admin.findOne({ email: email.toLowerCase(), isActive: true });
  if (!admin) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const validPassword = await bcrypt.compare(password, admin.passwordHash);
  if (!validPassword) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
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
    return res.status(401).json({ error: "Unauthorized" });
  }

  const admin = await Admin.findOne({ _id: adminId, isActive: true }).select("-passwordHash");
  if (!admin) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.json({ admin });
};

module.exports = { loginAdmin, getCurrentAdmin };
