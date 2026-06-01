/** Device keys for ad targeting (viewport-based on the user site). */
const AD_DEVICE_KEYS = ["all", "desktop", "tablet", "mobile"];

const AD_DEVICES = [
  { id: "all", label: "All screens" },
  { id: "desktop", label: "Desktop (large)" },
  { id: "tablet", label: "Tablet (medium)" },
  { id: "mobile", label: "Mobile (small)" },
];

module.exports = { AD_DEVICE_KEYS, AD_DEVICES };
