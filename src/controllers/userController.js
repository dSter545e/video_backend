const User = require("../models/User");

const getUsersAdmin = async (_req, res) => {
  const users = await User.find().select("_id name email isActive createdAt").sort({ createdAt: -1 });
  return res.json(users);
};

module.exports = {
  getUsersAdmin,
};
