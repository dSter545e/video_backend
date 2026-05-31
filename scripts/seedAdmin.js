const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const connectDB = require("../src/config/db");
const Admin = require("../src/models/Admin");

dotenv.config();

const seedAdmin = async () => {
  try {
    await connectDB();

    const name = process.env.ADMIN_NAME || "Super Admin";
    const email = (process.env.ADMIN_EMAIL || "admin@ott.com").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || "admin123";

    const passwordHash = await bcrypt.hash(password, 10);

    const existingAdmin = await Admin.findOne({ email });

    if (existingAdmin) {
      existingAdmin.name = name;
      existingAdmin.passwordHash = passwordHash;
      existingAdmin.role = "admin";
      existingAdmin.isActive = true;
      await existingAdmin.save();
      console.log("Admin updated successfully");
    } else {
      await Admin.create({
        name,
        email,
        passwordHash,
        role: "admin",
        isActive: true,
      });
      console.log("Admin created successfully");
    }

    process.exit(0);
  } catch (error) {
    console.error("Failed to seed admin:", error.message);
    process.exit(1);
  }
};

seedAdmin();
