const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signUserToken } = require("../utils/jwt");

const signupUser = async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "name, email and password are required" });
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() });
  if (existing) {
    return res.status(400).json({ error: "Email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
  });

  const token = signUserToken({ userId: user._id.toString(), email: user.email });
  return res.status(201).json({
    token,
    user: { id: user._id, name: user.name, email: user.email },
  });
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "email and password are required" });
  }

  const user = await User.findOne({ email: email.toLowerCase().trim(), isActive: true });
  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signUserToken({ userId: user._id.toString(), email: user.email });
  return res.json({
    token,
    user: { id: user._id, name: user.name, email: user.email },
  });
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "email is required" });
  }
  const user = await User.findOne({ email: email.toLowerCase().trim(), isActive: true });
  if (!user) {
    return res.json({ message: "If account exists, reset instructions sent." });
  }
  const resetToken = crypto.randomBytes(24).toString("hex");
  user.resetToken = resetToken;
  user.resetTokenExpiry = new Date(Date.now() + 1000 * 60 * 30);
  await user.save();
  return res.json({
    message: "Password reset initiated. Use reset token in support flow.",
    resetToken,
  });
};

const resetPassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "oldPassword and newPassword are required" });
  }
  if (String(newPassword).trim().length < 6) {
    return res.status(400).json({ error: "newPassword must be at least 6 characters" });
  }

  const user = await User.findOne({ _id: req.user.userId, isActive: true });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const isCurrentPasswordValid = await bcrypt.compare(String(oldPassword), user.passwordHash);
  if (!isCurrentPasswordValid) {
    return res.status(400).json({ error: "Old password is incorrect" });
  }

  user.passwordHash = await bcrypt.hash(String(newPassword), 10);
  user.resetToken = "";
  user.resetTokenExpiry = null;
  await user.save();

  return res.json({ message: "Password changed successfully." });
};

const getCurrentUser = async (req, res) => {
  return res.json({
    user: {
      id: req.user.userId,
      name: req.user.name,
      email: req.user.email,
    },
  });
};

module.exports = {
  signupUser,
  loginUser,
  forgotPassword,
  resetPassword,
  getCurrentUser,
};
