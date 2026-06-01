const AD_SLOTS = [
  {
    id: "header_leaderboard",
    label: "Below header (all pages)",
    placementType: "fixed",
    pages: ["all"],
  },
  {
    id: "home_between_sections",
    label: "Home — between video sections",
    placementType: "fixed",
    pages: ["home"],
  },
  {
    id: "watch_below_player",
    label: "Watch page — below video player",
    placementType: "fixed",
    pages: ["watch"],
  },
  {
    id: "watch_video_preroll",
    label: "Video player — preroll (before main video)",
    placementType: "video",
    pages: ["watch"],
    defaultSkipAfterSeconds: 5,
  },
  {
    id: "watch_video_overlay",
    label: "Video player — corner overlay during playback",
    placementType: "video",
    pages: ["watch"],
  },
  {
    id: "popup",
    label: "Popup modal (timed overlay)",
    placementType: "popup",
    pages: ["all"],
    defaultPopupDelaySeconds: 5,
    defaultPopupCooldownMinutes: 30,
  },
  {
    id: "watch_before_comments",
    label: "Watch page — before comments",
    placementType: "fixed",
    pages: ["watch"],
  },
  {
    id: "watch_before_recommendations",
    label: "Watch page — before related videos",
    placementType: "fixed",
    pages: ["watch"],
  },
  {
    id: "listing_in_feed",
    label: "Video grids — in-feed (every N cards)",
    placementType: "in_feed",
    pages: ["home", "videos", "categories", "search"],
    defaultInFeedEvery: 10,
  },
  {
    id: "footer_above",
    label: "Above footer (all pages)",
    placementType: "fixed",
    pages: ["all"],
  },
];

const AD_SLOT_IDS = AD_SLOTS.map((slot) => slot.id);
const AD_PAGE_KEYS = ["all", "home", "watch", "videos", "categories", "search", "auth", "legal"];

const getSlotMeta = (slotId) => AD_SLOTS.find((slot) => slot.id === slotId) || null;

module.exports = {
  AD_SLOTS,
  AD_SLOT_IDS,
  AD_PAGE_KEYS,
  getSlotMeta,
};
