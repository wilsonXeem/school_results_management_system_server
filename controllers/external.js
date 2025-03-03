const ExternalCourse = require("../models/ExternalCourse");

module.exports.add_external_course = async (req, res) => {
  const { session, reg_no, course_code, course_title, unit_load, semester } =
    req.body;

  try {
    const newCourse = new ExternalCourse({
      session,
      course_code,
      course_title,
      unit_load,
      semester,
    });

    await newCourse.save();

    res
      .status(201)
      .json({
        message: "External course added successfully",
        course: newCourse,
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error adding external course" });
  }
};
