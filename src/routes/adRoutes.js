const express = require("express");
const { adminAuth } = require("../middleware/authMiddleware");
const {
  getPublicAds,
  getAdSlotsMeta,
  listAdsAdmin,
  createAdAdmin,
  updateAdAdmin,
  deleteAdAdmin,
} = require("../controllers/adController");

const router = express.Router();

router.get("/", getPublicAds);
router.get("/slots", getAdSlotsMeta);

router.get("/admin/all", adminAuth, listAdsAdmin);
router.post("/admin", adminAuth, createAdAdmin);
router.put("/admin/:id", adminAuth, updateAdAdmin);
router.delete("/admin/:id", adminAuth, deleteAdAdmin);

module.exports = router;
