const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const semesterResultSchema = new Schema(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "Student", index: true }, // Indexing for faster queries
    session: { type: String, required: true, index: true },
    level: { type: Number },
    semester: { type: Number, required: true },
    gpa: { type: Number, default: 0 },
    session_gpa: { type: Number, default: 0 },
    courses: [
      {
        course_code: { type: String, required: true },
        course_title: { type: String, required: true },
        unit_load: { type: Number, default: 0 },
        ca: { type: Number, default: 0 },
        exam: { type: Number, default: 0 },
        total: { type: Number, default: 0 },
        grade: { type: Number, default: 0 }, // Grade can be letter-based (A, B, C, etc.)
        external: { type: Boolean, default: false },
      },
    ],
    published: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SemesterResult", semesterResultSchema);
