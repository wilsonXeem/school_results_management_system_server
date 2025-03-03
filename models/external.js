const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const externalCourseSchema = new Schema(
  {
    session: { type: String, required: true, index: true },
    course_code: { type: String, required: true },
    course_title: { type: String, required: true },
    unit_load: { type: Number, required: true },
    semester: { type: Number, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ExternalCourse", externalCourseSchema);
