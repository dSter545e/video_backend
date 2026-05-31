const jwt = require("jsonwebtoken");

const signAdminToken = (payload) => {
  const secret = process.env.JWT_SECRET || "change-this-secret";
  return jwt.sign(payload, secret, { expiresIn: "1d" });
};

const signUserToken = (payload) => {
  const secret = process.env.JWT_SECRET || "change-this-secret";
  return jwt.sign(payload, secret, { expiresIn: "7d" });
};

const verifyAdminToken = (token) => {
  const secret = process.env.JWT_SECRET || "change-this-secret";
  return jwt.verify(token, secret);
};

const verifyUserToken = (token) => {
  const secret = process.env.JWT_SECRET || "change-this-secret";
  return jwt.verify(token, secret);
};

module.exports = {
  signAdminToken,
  verifyAdminToken,
  signUserToken,
  verifyUserToken,
};
