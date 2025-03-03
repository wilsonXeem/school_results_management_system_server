const Student = require("../models/student");
const Class = require("../models/class");
const Session = require("../models/session");
const SemesterResult = require("../models/semester_result");
const External = require("../models/external");
const professionals = require("../utils/professionals");
const bcrypt = require("bcrypt");
const error = require("../utils/error_handler");
const {
  calculateGrade,
  get_gpa,
  get_cgpa,
  get_session_gpa,
} = require("../utils/grade_utils");

module.exports.register_students = async (req, res, next) => {
  let {
    students, // Array of { reg_no: fullname }
    level,
    course_title,
    course_code,
    unit_load,
    semester,
    session,
    external,
  } = req.body;

  level = Number(level);
  semester = Number(semester);

  try {
    // Get session and ensure it exists
    const sessionData = await Session.findOne({ session }).populate("classes");
    if (!sessionData) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Get or create the correct class within the session
    let classData = sessionData.classes.find((cls) => cls.level === level);
    if (!classData) {
      classData = new Class({ level, students: [] });
      sessionData.classes.push(classData);
      await sessionData.save();
    }

    const bulkUpdates = [];
    const externals = [];
    const studentIds = new Set(classData.students.map((id) => id.toString()));

    for (const studentObj of students) {
      try {
        const reg_no = Object.keys(studentObj)[0];
        const fullname = studentObj[reg_no];
        if (!reg_no || !fullname) continue;

        let student = await Student.findOne({ reg_no });

        if (!student) {
          student = new Student({ fullname, reg_no, level });
          await student.save();
        } else if (student.level !== level) {
          student.level = level;
          bulkUpdates.push(student.save());
        }

        // Ensure the student has only one SemesterResult for the same session & semester
        let semesterResult = await SemesterResult.findOne({
          student_id: student._id,
          session,
          semester,
        });

        if (!semesterResult) {
          semesterResult = new SemesterResult({
            student_id: student._id,
            session,
            level,
            semester,
            courses: [],
          });
          await semesterResult.save();
        } else {
          // Ensure the level remains consistent
          semesterResult.level = level;
        }

        // Ensure the course is registered only once
        const courseExists = semesterResult.courses.some(
          (c) => c.course_code.toLowerCase() === course_code.toLowerCase()
        );

        if (!courseExists) {
          semesterResult.courses.push({
            course_code,
            course_title,
            unit_load,
            corrected_unit_load: unit_load,
            external,
          });
          await semesterResult.save();
        }

        // Track external courses for session
        if (external) {
          externals.push({ course_code, course_title, unit_load, semester });
        }

        // Add student to class if not already present
        if (!studentIds.has(student._id.toString())) {
          classData.students.push(student._id);
          studentIds.add(student._id.toString());
        }
      } catch (err) {
        console.error("Error processing student: ", err);
        continue;
      }
    }

    if (bulkUpdates.length > 0) {
      await Promise.all(bulkUpdates);
    }

    await classData.save();

    if (externals.length > 0) {
      sessionData.externals.push(...externals);
      await sessionData.save();
    }

    // Fetch the updated list of students and their results
    const studentResults = await SemesterResult.find({
      student_id: { $in: classData.students },
      session,
      semester, // Ensure only one semester per student
    }).populate("student_id"); // Populate student details

    const studentsData = studentResults.map((result) => ({
      student_id: result.student_id._id,
      fullname: result.student_id.fullname,
      reg_no: result.student_id.reg_no,
      level: result.level, // Ensure correct level
      cgpa: result.student_id.cgpa,
      gpa: result.gpa,
      semester,
      session: result.session,
      courses: result.courses, // Include their courses for the semester
    }));

    res.status(200).json({
      message: "Students registered successfully",
      class: classData,
      students: studentsData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering students" });
  }
};

module.exports.register_external = async (req, res, next) => {
  let {
    reg_no,
    level,
    course_title,
    course_code,
    unit_load,
    semester,
    session,
    class_id,
    external,
  } = req.body;
  semester = Number(semester);
  level = Number(level);

  try {
    // Get session and ensure it exists
    const sessionData = await Session.findOne({ session }).populate("classes");
    if (!sessionData) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Get the correct class within the session
    const classData = sessionData.classes.find((cls) => cls.level === level);
    if (!classData) {
      return res
        .status(404)
        .json({ message: "Class not found for this session" });
    }

    // Check if student exists
    let student = await Student.findOne({ reg_no });
    if (!student) {
      return res.status(500).json({ message: "Student not found!" });
    }

    // Register student in SemesterResult
    let semesterResult = await SemesterResult.findOne({
      student_id: student._id,
      session,
      level,
      semester,
    });

    if (!semesterResult) {
      semesterResult = new SemesterResult({
        student_id: student._id,
        session,
        level,
        semester,
        courses: [
          {
            course_code,
            course_title,
            unit_load,
            corrected_unit_load: unit_load,
            external,
          },
        ],
      });
      await semesterResult.save();
    } else {
      // Add course if not already registered
      const courseExists = semesterResult.courses.some(
        (c) => c.course_code === course_code
      );
      if (!courseExists) {
        semesterResult.courses.push({
          course_code,
          course_title,
          unit_load,
          corrected_unit_load: unit_load,
          external,
        });
        await semesterResult.save();
      }
    }

    // Track external courses only if they don't exist already
    if (external) {
      const externalExists = await External.findOne({ session, course_code });
      if (!externalExists) {
        const externals = new External({
          session,
          course_code,
          course_title,
          unit_load,
          semester,
        });
        await externals.save();
        sessionData.externals.push(externals._id);
        sessionData.save();
      }
    }

    // Fetch the updated list of students and their results
    const studentResults = await SemesterResult.find({
      student_id: { $in: classData.students },
      session,
      level,
      semester,
    }).populate("student_id"); // Populate student details

    const studentsData = studentResults.map((result) => ({
      student_id: result.student_id._id,
      fullname: result.student_id.fullname,
      reg_no: result.student_id.reg_no,
      level: result.student_id.level,
      cgpa: result.student_id.cgpa,
      gpa: result.gpa,
      semester,
      session: result.session,
      courses: result.courses, // Include their courses for the semester
    }));

    res.status(200).json({
      message: "Students registered successfully",
      class: classData,
      students: studentsData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering students" });
  }
};

module.exports.add_score = async (req, res, next) => {
  let { students, session, semester, course_code, level } = req.body;
  semester = Number(semester);
  level = Number(level);

  try {
    const regNos = students.map((s) => s.reg_no); // Ensure consistency
    const studentRecords = await Student.find({ reg_no: { $in: regNos } });

    const bulkUpdates = [];

    for (const studentData of students) {
      try {
        let { reg_no, ca, exam } = studentData;
        ca = Number(ca);
        exam = Number(exam);

        const student = studentRecords.find((s) => s.reg_no === reg_no);
        if (!student) {
          console.warn(`Skipping: Student ${reg_no} not found.`);
          continue;
        }

        let semesterResult = await SemesterResult.findOne({
          student_id: student._id,
          session,
          semester,
        });

        if (!semesterResult) {
          console.warn(`Skipping: No semester record found for ${reg_no}.`);
          continue;
        }

        let sessionResult = await SemesterResult.find({
          student_id: student._id,
          session,
        });

        if (!Array.isArray(sessionResult)) sessionResult = []; // Ensure it's iterable

        const course = semesterResult.courses.find(
          (c) => c.course_code === course_code
        );

        if (!course) {
          console.warn(
            `Skipping: Course ${course_code} not found for ${reg_no}.`
          );
          continue;
        }

        course.ca = ca;
        course.exam = exam;
        course.total = ca + exam;

        if (["pct224", "pct422"].includes(course_code.toLowerCase())) {
          course.grade = await calculateGrade(course.total, "ceutics");
        } else if (course_code.toLowerCase() in professionals) {
          course.grade = await calculateGrade(course.total, "regular");
        } else {
          course.grade = await calculateGrade(course.total, "external");
        }

        semesterResult.gpa = get_gpa(semesterResult);
        student.cgpa = await get_cgpa(student._id.toString());

        // Only calculate session_gpa if it's second semester AND sessionResult is available
        if (semester === 2 && sessionResult.length > 0) {
          semesterResult.session_gpa = await get_session_gpa(sessionResult);
        }

        bulkUpdates.push({
          updateOne: {
            filter: { _id: semesterResult._id },
            update: {
              $set: {
                courses: semesterResult.courses,
                gpa: semesterResult.gpa,
                session_gpa: semesterResult.session_gpa || null, // Ensure it's set properly
              },
            },
          },
        });

        await student.save();
      } catch (err) {
        console.error(`Error processing student ${studentData.reg_no}:`, err);
      }
    }

    if (bulkUpdates.length > 0) {
      await SemesterResult.bulkWrite(bulkUpdates);
    }

    res.status(200).json({ message: "Scores added successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error adding scores" });
  }
};

module.exports.get_class = async (req, res) => {
  const { class_id, semester, level, session } = req.body; // Expect class_id and semester

  try {
    // Find the class by ID and populate students
    const foundClass = await Class.findById(class_id).populate("students");

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    // Get student IDs from the class
    const studentIds = foundClass.students.map((student) => student._id);

    // Find students with results for the given semester
    const semesterResults = await SemesterResult.find({
      student_id: { $in: studentIds },
      session,
      semester,
      level,
    }).populate("student_id"); // Populate student details

    // Extract students with their results
    const students = semesterResults.map((result) => ({
      student_id: result.student_id._id,
      fullname: result.student_id.fullname,
      reg_no: result.student_id.reg_no,
      level: result.student_id.level,
      cgpa: result.student_id.cgpa,
      gpa: result.gpa,
      session_gpa: result.session_gpa,
      semester,
      session: result.session,
      courses: result.courses, // Include their courses for the semester
    }));

    res.status(200).json({
      class: foundClass,
      students,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error retrieving class" });
  }
};

module.exports.get_students_by_course = async (req, res) => {
  let { session, semester, course_code } = req.params;
  semester = Number(semester);

  try {
    // Find all semester results that match the given session and semester
    const results = await SemesterResult.find({
      session,
      semester,
      "courses.course_code": course_code,
    }).populate("student_id");

    if (!results.length) {
      return res.status(404).json({
        message:
          "No students found for this course in the given session and semester",
      });
    }

    // Extract student details along with their course information
    const students = results.map((result) => {
      const student = result.student_id;
      const course = result.courses.find((c) => c.course_code === course_code);

      return {
        student_id: student._id,
        fullname: student.fullname,
        reg_no: student.reg_no,
        ca: course.ca || 0,
        exam: course.exam || 0,
        total: course.total || 0,
        grade: course.grade || 0,
        course_code: course.course_code,
      };
    });

    res.status(200).json(students);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching students for the course" });
  }
};

module.exports.probation_list = async (req, res) => {
  const { class_id, level, session } = req.body;

  // 100-level course prefixes
  const coursePrefixes = ["mth", "phy", "chm", "bio", "gsp"];

  try {
    // Find the class by ID and populate students
    const foundClass = await Class.findById(class_id).populate("students");

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    // Get student IDs from the class
    const studentIds = foundClass.students.map((student) => student._id);

    // Find students with results for the second semester
    const semesterResults = await SemesterResult.find({
      student_id: { $in: studentIds },
      session,
      semester: 2, // Second semester only
      level,
    }).populate("student_id");

    let probationStudents = [];

    if (level === 100) {
      // Handle 100-level probation logic
      probationStudents = semesterResults.filter((result) => {
        const courseGroups = {};

        // Group courses by prefix and calculate averages
        result.courses.forEach((course) => {
          const match = course.course_code.match(/^([a-zA-Z]+)\d+/);
          if (match) {
            const prefix = match[1].toLowerCase();
            if (coursePrefixes.includes(prefix)) {
              if (!courseGroups[prefix]) {
                courseGroups[prefix] = [];
              }
              courseGroups[prefix].push(course.score); // Store scores
            }
          }
        });

        // Check if any subject group's average is below 40
        return Object.values(courseGroups).some((scores) => {
          const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
          return avg < 40;
        });
      });
    } else {
      // Handle probation for other levels (GPA-based)
      probationStudents = semesterResults.filter(
        (result) => result.session_gpa < 2.5
      );
    }

    // Format the final probation list
    const formattedProbationList = probationStudents.map((result) => ({
      student_id: result.student_id._id,
      fullname: result.student_id.fullname,
      reg_no: result.student_id.reg_no,
      level: result.student_id.level,
      session_gpa: result.session_gpa || "N/A", // GPA for other levels
      session: result.session,
    }));

    res.status(200).json({
      students: formattedProbationList,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error generating probation list" });
  }
};

module.exports.error_students = async (req, res) => {
  const { class_id, semester, level, session } = req.body;

  try {
    // Find the class by ID and populate students
    const foundClass = await Class.findById(class_id).populate("students");
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const studentIds = foundClass.students.map((student) => student._id);
    const sessions = await SemesterResult.distinct("session", {
      student_id: { $in: studentIds },
      semester: 2, // Only consider second semester results
    });
    sessions.sort(); // Ensure sessions are in order

    const errorStudents = [];

    for (const student of foundClass.students) {
      const studentResults = await SemesterResult.find({
        student_id: student._id,
        semester: 2, // Only check second semester
        session: { $in: sessions },
      }).sort("session");

      let probationSessions = [];
      let probationDetails = [];

      for (const result of studentResults) {
        if (result.level === 100) {
          const courseAverages = {};

          for (const course of result.courses) {
            const prefix = course.course_code.match(/^[a-zA-Z]+/)[0];
            if (!courseAverages[prefix]) {
              courseAverages[prefix] = [];
            }
            courseAverages[prefix].push(course.score);
          }

          const averages = Object.entries(courseAverages).map(
            ([course, scores]) => {
              return {
                course,
                average: scores.reduce((a, b) => a + b, 0) / scores.length,
              };
            }
          );

          if (averages.some((avg) => avg.average < 40)) {
            probationSessions.push(result.session);
            probationDetails.push({
              session: result.session,
              level: result.level,
              averages,
            });
          }
        } else {
          if (result.session_gpa < 2.5) {
            probationSessions.push(result.session);
            probationDetails.push({
              session: result.session,
              level: result.level,
              gpa: result.session_gpa,
            });
          }
        }
      }

      if (probationSessions.length > 1) {
        errorStudents.push({
          student_id: student._id,
          fullname: student.fullname,
          reg_no: student.reg_no,
          current_level: student.level,
          probation_sessions: probationDetails,
        });
      }
    }

    res.status(200).json({ students: errorStudents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error retrieving error students" });
  }
};

const cleanStudentNames = async () => {
  try {
    const students = await Student.find({}, "fullname");

    let updatedCount = 0;
    const updates = [];

    students.forEach((student) => {
      const cleanedName = student.fullname.replace(/^[^A-Za-z]+/, "").trim();

      if (cleanedName !== student.fullname) {
        updates.push(
          Student.updateOne({ _id: student._id }, { fullname: cleanedName })
        );
        updatedCount++;
      }
    });

    if (updates.length > 0) {
      await Promise.all(updates);
    }

    console.log(
      `Processed ${students.length} students, cleaned ${updatedCount} names.`
    );
    return { totalProcessed: students.length, namesUpdated: updatedCount };
  } catch (err) {
    console.error("Error cleaning student names:", err);
    throw new Error("Error cleaning student names");
  }
};

// cleanStudentNames()

const updateSemesterLevels = async () => {
  try {
    const semesterResults = await SemesterResult.find({}).populate("courses");

    let updatedCount = 0;
    const updates = [];

    for (const result of semesterResults) {
      if (!result.courses || result.courses.length === 0) continue;

      // Extract levels from course codes
      const levels = result.courses
        .map((course) => {
          const match = course.course_code.match(/\D(\d)/); // Extract first digit after alphabets
          return match ? parseInt(match[1]) * 100 : null; // Convert to level (e.g., 4 -> 400)
        })
        .filter((level) => level !== null); // Remove null values

      if (levels.length === 0) continue;

      // Determine the highest level
      const correctLevel = Math.max(...levels);

      if (correctLevel !== result.level) {
        updates.push(
          SemesterResult.updateOne({ _id: result._id }, { level: correctLevel })
        );
        updatedCount++;
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates);
    }

    console.log(
      `Processed ${semesterResults.length} records, updated ${updatedCount} semester levels.`
    );
    return {
      totalProcessed: semesterResults.length,
      levelsUpdated: updatedCount,
    };
  } catch (err) {
    console.error("Error updating semester levels:", err);
    throw new Error("Error updating semester levels");
  }
};

// updateSemesterLevels()
//   .then((result) => console.log(result))
//   .catch((err) => console.error(err));
