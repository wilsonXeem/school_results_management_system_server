const Student = require("../models/student");
const SemesterResult = require("../models/semester_result");
const Class = require("../models/class");
const Session = require("../models/session");
const professionals = require("../utils/professionals");
const {
  calculateGrade,
  get_gpa,
  get_session_gpa,
  get_cgpa,
} = require("../utils/grade_utils");

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
        ?.courses.filter((course) => !(course.course_code in professionals)) ||
      [];
    const secondExternal =
      results
        .find((r) => r.semester === 2)
        ?.courses.filter((course) => !(course.course_code in professionals)) ||
      [];

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

module.exports.getSemesterResultsByRegNo = async (req, res) => {
  const { reg_no, session, semester } = req.body;

  if (!reg_no || !session || !semester) {
    return res
      .status(400)
      .json({ message: "reg_no, session, and semester are required" });
  }

  try {
    const student = await Student.findOne({ reg_no });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const semesterResult = await SemesterResult.findOne({
      student_id: student._id,
      session,
      semester: Number(semester),
    });

    if (!semesterResult) {
      return res
        .status(404)
        .json({ message: "Semester result not found for this student" });
    }

    res.status(200).json({
      student,
      semester_result: semesterResult,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching semester result" });
  }
};

module.exports.updateStudentCourseTotal = async (req, res) => {
  const { reg_no, session, semester, course_code, total } = req.body;

  if (!reg_no || !session || !semester || !course_code || total === undefined) {
    return res.status(400).json({
      message: "reg_no, session, semester, course_code, and total are required",
    });
  }

  try {
    const student = await Student.findOne({ reg_no });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const semesterResult = await SemesterResult.findOne({
      student_id: student._id,
      session,
      semester: Number(semester),
    });

    if (!semesterResult) {
      return res
        .status(404)
        .json({ message: "Semester result not found" });
    }

    const course = semesterResult.courses.find(
      (c) => c.course_code === course_code
    );

    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const totalScore = Number(total);
    if (Number.isNaN(totalScore)) {
      return res.status(400).json({ message: "total must be a number" });
    }

    course.total = totalScore;
    course.ca = Number((totalScore * 0.3).toFixed(2));
    course.exam = Number((totalScore * 0.7).toFixed(2));

    if (["pct224", "pct422"].includes(course_code.toLowerCase())) {
      course.grade = await calculateGrade(course.total, "ceutics");
    } else if (course_code.toLowerCase() in professionals) {
      course.grade = await calculateGrade(course.total, "regular");
    } else {
      course.grade = await calculateGrade(course.total, "external");
    }

    semesterResult.gpa = Number(get_gpa(semesterResult));

    if (Number(semester) === 2) {
      const sessionResults = await SemesterResult.find({
        student_id: student._id,
        session,
      });
      semesterResult.session_gpa = Number(get_session_gpa(sessionResults));
    }

    await semesterResult.save();

    student.cgpa = Number(await get_cgpa(student._id.toString()));
    await student.save();

    res.status(200).json({
      message: "Course score updated successfully",
      course,
      gpa: semesterResult.gpa,
      session_gpa: semesterResult.session_gpa,
      cgpa: student.cgpa,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error updating course score" });
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

module.exports.correctSemesterLevels = async (req, res) => {
  try {
    const { session, semester } = req.body;
    const parsedSemester = Number(semester);

    if (!session || ![1, 2].includes(parsedSemester)) {
      return res
        .status(400)
        .json({ message: "session and semester (1 or 2) are required" });
    }

    // Get all semester results for the session and semester
    const semesterResults = await SemesterResult.find({
      session,
      semester: parsedSemester,
    }).populate("student_id");

    let updatedCount = 0;
    for (const result of semesterResults) {
      if (!result.courses || result.courses.length === 0) continue;

      const counts = {};

      // Count dominant course levels
      for (const course of result.courses) {
        const match = course.course_code.match(/(\d+)/); // extract number part
        if (match) {
          const firstDigit = match[0][0]; // first digit of numeric part
          counts[firstDigit] = (counts[firstDigit] || 0) + 1;
        }
      }

      // Find dominant digit
      const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (!dominant) continue;

      const dominantLevel = parseInt(dominant[0]) * 100; // e.g., "4" → 400

      // Update semester result level
      if (result.level !== dominantLevel) {
        result.level = dominantLevel;
        await result.save();
        updatedCount += 1;
      }

      // Update student main level too
      if (result.student_id) {
        if (result.student_id.level !== dominantLevel) {
          result.student_id.level = dominantLevel;
          await result.student_id.save();
        }
      }

    }

    res.status(200).json({
      message: "Semester and student levels corrected successfully!",
      total: semesterResults.length,
      updated: updatedCount,
    });
  } catch (err) {
    console.error("Error correcting levels:", err);
    res.status(500).json({ message: "Error correcting levels" });
  }
};
