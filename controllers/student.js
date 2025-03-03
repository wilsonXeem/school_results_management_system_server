const Student = require("../models/student");
const SemesterResult = require("../models/semester_result");
const Class = require("../models/class");
const Session = require("../models/session");
const professionals = require("../utils/professionals");

module.exports.get_student = async (req, res) => {
  const { reg_no } = req.body;

  try {
    const student = await Student.findOne({ reg_no });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.status(200).json(student);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error retrieving student" });
  }
};

module.exports.get_results_by_semester = async (req, res) => {
  const { student_id } = req.params;

  try {
    const results = await SemesterResult.find({
      student_id,
    }).populate("student_id");

    if (!results) {
      return res
        .status(404)
        .json({ message: "No results found for this semester" });
    }

    res.status(200).json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching semester results" });
  }
};

module.exports.get_results_by_session = async (req, res) => {
  const { student_id, session } = req.params;

  try {
    const results = await SemesterResult.find({ student_id, session }).populate(
      "student_id"
    );

    if (!results.length) {
      return res
        .status(404)
        .json({ message: "No results found for this session" });
    }

    // Extract student details
    const student = results[0].student_id;
    const level = results[0].level;

    // Separate first and second semester courses
    const firstSemester =
      results
        .find((r) => r.semester === 1)
        ?.courses.filter((course) => course.course_code in professionals) || [];
    const secondSemester =
      results
        .find((r) => r.semester === 2)
        ?.courses.filter((course) => course.course_code in professionals) || [];
    const firstExternal =
      results
        .find((r) => r.semester === 1)
        ?.courses.filter((course) => !(course.course_code in professionals)) || [];
    const secondExternal =
      results
        .find((r) => r.semester === 2)
        ?.courses.filter((course) => !(course.course_code in professionals)) || [];

    // Calculate session CGPA based on total unit load and grades
    let totalGradePoints = 0;
    let totalUnitLoad = 0;

    results.forEach((result) => {
      result.courses.forEach((course) => {
        totalGradePoints += course.unit_load * course.grade;
        totalUnitLoad += course.unit_load;
      });
    });

    const sessionCgpa =
      totalUnitLoad > 0 ? (totalGradePoints / totalUnitLoad).toFixed(2) : 0;

    res.status(200).json({
      fullname: student.fullname,
      profile_image: student.profile_image,
      reg_no: student.reg_no,
      moe: student.moe,
      level,
      session,
      first_semester: firstSemester,
      second_semester: secondSemester,
      first_external: firstExternal,
      second_external: secondExternal,
      session_cgpa: Number(sessionCgpa),
      cgpa: student.cgpa,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching session results" });
  }
};

// Search student by reg_no
module.exports.searchStudent = async (req, res) => {
  const { reg_no } = req.body;
  try {
    const student = await Student.findOne({ reg_no });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    res.status(200).json({ student, message: "student fetched successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Error searching student" });
  }
};

// Update student name
module.exports.updateStudentName = async (req, res) => {
  const { reg_no, fullname } = req.body;
  try {
    const student = await Student.findOneAndUpdate(
      { reg_no },
      { fullname },
      { new: true }
    );
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    res
      .status(200)
      .json({ student, message: "Student name updated successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Error updating student name" });
  }
};

// Update semesterResult level
module.exports.updateSemesterResultLevel = async (req, res) => {
  const { reg_no, session, semester, level } = req.body;
  try {
    const student = await Student.findOne({ reg_no });

    const result = await SemesterResult.findOneAndUpdate(
      { student_id: student._id, session, semester },
      { level },
      { new: true }
    );
    if (!result) {
      return res.status(404).json({ message: "Semester result not found" });
    }
    res
      .status(200)
      .json({ result, message: "Semester level updated successfully!" });
  } catch (err) {
    res.status(500).json({ message: "Error updating semester result level" });
  }
};

// Remove semester for a student
module.exports.removeSemester = async (req, res) => {
  const { reg_no, session, semester } = req.body;
  try {
    const student = await Student.findOne({ reg_no });
    const result = await SemesterResult.findOneAndDelete({
      student_id: student._id,
      session,
      semester,
    });
    if (!result) {
      return res.status(404).json({ message: "Semester not found" });
    }
    res.status(200).json({ message: "Semester removed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error removing semester" });
  }
};

// Remove session for a student
module.exports.removeSession = async (req, res) => {
  const { reg_no, session } = req.body;
  try {
    const student = await Student.findOne({ reg_no });
    const result = await SemesterResult.deleteMany({
      student_id: student._id,
      session,
    });
    if (!result.deletedCount) {
      return res
        .status(404)
        .json({ message: "No records found for this session" });
    }
    res.status(200).json({ message: "Session removed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error removing session" });
  }
};

// Remove course from semester
module.exports.removeCourseFromSemester = async (req, res) => {
  const { reg_no, session, semester, course_code } = req.body;
  try {
    const student = await Student.findOne({ reg_no });

    const result = await SemesterResult.findOne({
      student_id: student._id,
      session,
      semester,
    });
    if (!result) {
      return res.status(404).json({ message: "Semester result not found" });
    }
    result.courses = result.courses.filter(
      (course) => course.course_code !== course_code
    );
    await result.save();
    res.status(200).json({ message: "Course removed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error removing course" });
  }
};

// Remove student and all associated records
module.exports.removeStudent = async (req, res) => {
  const { reg_no } = req.body;
  try {
    const student = await Student.findOneAndDelete({ reg_no });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }
    await SemesterResult.deleteMany({ reg_no });
    res.status(200).json({ message: "Student removed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error removing student" });
  }
};

module.exports.moe = async (req, res) => {
  try {
    const studentsToUpdate = req.body.students;

    if (!Array.isArray(studentsToUpdate) || studentsToUpdate.length === 0) {
      return res.status(400).json({ message: "Invalid request format" });
    }

    const bulkOperations = studentsToUpdate.map(({ reg_no, moe }) => ({
      updateOne: {
        filter: { reg_no },
        update: { moe },
      },
    }));

    const result = await Student.bulkWrite(bulkOperations);

    res.status(200).json({
      message: "MOE updated successfully",
    });
  } catch (err) {
    console.error("Error updating MOE:", err);
    res.status(500).json({ message: "Internal server error" });
  }
};

module.exports.updateMoe = async (req, res) => {
  try {
    const { reg_no, moe } = req.body;

    if (!reg_no || !moe) {
      return res.status(400).json({ message: "reg_no and moe are required" });
    }

    const updatedStudent = await Student.findOneAndUpdate(
      { reg_no },
      { moe },
      { new: true }
    );

    if (!updatedStudent) {
      return res.status(404).json({ message: "Student not found" });
    }

    res.status(200).json({
      message: "Student MOE updated successfully",
      student: updatedStudent,
    });
  } catch (error) {
    console.error("Error updating student's MOE:", error);
    res.status(500).json({ message: "Server error" });
  }
};