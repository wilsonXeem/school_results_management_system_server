const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const classSchema = new Schema(
  {
    level: { type: Number, required: true, index: true }, // Indexed for faster searches
    students: [{ type: Schema.Types.ObjectId, ref: "Student" }], // Flattened structure
    courses: {
      first_semester: [{ type: String }],
      second_semester: [{ type: String }],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Class", classSchema);

