const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const studentSchema = new Schema(
  {
    verified: { type: Boolean, default: false },
    fullname: { type: String, required: [true, "Name should not be empty"] },
    email: { type: String, unique: true, sparse: true }, // Indexing for fast lookup
    moe: { type: String },
    profile_image: {
      type: String,
      default:
        "https://res.cloudinary.com/muyi-hira-app/image/upload/v1733406309/user-icon-flat-isolated-on-white-background-user-symbol-vector-illustration_lp8qko.jpg",
    },
    reg_no: {
      type: String,
      required: [true, "Reg number is required"],
      unique: true,
    }, // Indexing for fast lookup
    level: { type: Number, index: true }, // Index for faster student retrieval by level
    cgpa: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Student", studentSchema);
