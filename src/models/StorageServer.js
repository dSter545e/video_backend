const mongoose = require("mongoose");

const storageServerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    accountId: { type: String, required: true, trim: true },
    accessKeyId: { type: String, required: true, trim: true },
    secretAccessKey: { type: String, required: true, trim: true },
    bucketName: { type: String, required: true, trim: true },
    publicBaseUrl: { type: String, default: "", trim: true },
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    healthStatus: {
      type: String,
      enum: ["online", "offline", "unknown"],
      default: "unknown",
    },
    healthCheckedAt: { type: Date, default: null },
    healthMessage: { type: String, default: "" },
  },
  { timestamps: true }
);

storageServerSchema.pre("save", async function () {
  if (this.isDefault) {
    await this.constructor.updateMany({ _id: { $ne: this._id } }, { $set: { isDefault: false } });
  }
});

module.exports = mongoose.model("StorageServer", storageServerSchema);
