const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const sessionSchema = new Schema(
  {
    session: { type: String, unique: true, index: true },
    classes: [{ type: Schema.Types.ObjectId, ref: "Class" }],
    current: { type: Boolean, default: false },
    externals: [{ type: Schema.Types.ObjectId, ref: "ExternalCourse" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Session", sessionSchema);
