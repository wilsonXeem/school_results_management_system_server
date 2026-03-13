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
  get_non_600_level_gpa,
  get_cgpa,
  get_non_600_level_session_gpa,
  filterApprovedCourses,
} = require("../utils/grade_utils");

const normalizeRegNo = (value) => String(value ?? "").trim();
const normalizeCourseCode = (value) => String(value ?? "").toLowerCase().trim();
const normalizeName = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();

const pushSkip = (skipped, reg_no, reason) => {
  if (skipped.length >= 200) return;
  skipped.push({ reg_no, reason });
};

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
  const normalizedCourseCode = normalizeCourseCode(course_code);
  const summary = {
    total_rows: Array.isArray(students) ? students.length : 0,
    processed: 0,
    skipped: 0,
    skipped_details: [],
  };

  if (!normalizedCourseCode || !session || !Number.isFinite(level) || !Number.isFinite(semester)) {
    return res.status(400).json({
      message: "course_code, session, level, and semester are required",
      summary,
    });
  }

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({
      message: "students must be a non-empty array",
      summary,
    });
  }

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
        const [rawRegNo, rawName] = Object.entries(studentObj || {})[0] || [];
        const reg_no = normalizeRegNo(rawRegNo);
        const fullname = normalizeName(rawName);
        if (!reg_no || !fullname) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Missing reg_no or fullname");
          continue;
        }

        // ✅ Validation: reg_no must start with a number, fullname must start with a letter
        if (!/^[0-9]/.test(reg_no) || !/^[A-Za-z]/.test(fullname)) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Invalid reg_no/fullname format");
          continue;
        }

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
          (c) => normalizeCourseCode(c.course_code) === normalizedCourseCode
        );

        if (!courseExists) {
          semesterResult.courses.push({
            course_code: normalizedCourseCode,
            course_title,
            unit_load,
            corrected_unit_load: unit_load,
            external,
          });
          await semesterResult.save();
        }

        // Track external courses for session
        if (external) {
          externals.push({
            course_code: normalizedCourseCode,
            course_title,
            unit_load,
            semester,
          });
        }

        // Add student to class if not already present
        if (!studentIds.has(student._id.toString())) {
          classData.students.push(student._id);
          studentIds.add(student._id.toString());
        }
        summary.processed += 1;
      } catch (err) {
        console.error("Error processing student: ", err);
        summary.skipped += 1;
        pushSkip(
          summary.skipped_details,
          normalizeRegNo(Object.keys(studentObj || {})[0]),
          "Unexpected error while processing row"
        );
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
      summary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering students" });
  }
};

module.exports.register_external = async (req, res, next) => {
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
  const normalizedCourseCode = normalizeCourseCode(course_code);
  const summary = {
    total_rows: Array.isArray(students) ? students.length : 0,
    processed: 0,
    skipped: 0,
    skipped_details: [],
  };

  if (!normalizedCourseCode || !session || !Number.isFinite(level) || !Number.isFinite(semester)) {
    return res.status(400).json({
      message: "course_code, session, level, and semester are required",
      summary,
    });
  }

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({
      message: "students must be a non-empty array",
      summary,
    });
  }

  try {
    const sessionData = await Session.findOne({ session }).populate("classes");
    if (!sessionData) {
      return res.status(404).json({ message: "Session not found" });
    }

    let classData = sessionData.classes.find((cls) => cls.level === level);
    if (!classData) {
      classData = new Class({ level, students: [] });
      sessionData.classes.push(classData);
      await sessionData.save();
    }

    const studentIds = new Set(classData.students.map((id) => id.toString()));
    const studentsData = [];

    for (const studentObj of students) {
      const [rawRegNo] = Object.entries(studentObj || {})[0] || [];
      const reg_no = normalizeRegNo(rawRegNo);
      if (!reg_no) {
        summary.skipped += 1;
        pushSkip(summary.skipped_details, reg_no, "Missing reg_no");
        continue;
      }

      try {
        const student = await Student.findOne({ reg_no });
        if (!student) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Student not found");
          continue;
        }

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
        }

        const courseExists = semesterResult.courses.some(
          (c) => normalizeCourseCode(c.course_code) === normalizedCourseCode
        );

        if (!courseExists) {
          semesterResult.courses.push({
            course_code: normalizedCourseCode,
            course_title,
            unit_load,
            corrected_unit_load: unit_load,
            external,
          });
          await semesterResult.save();
        }

        if (!studentIds.has(student._id.toString())) {
          classData.students.push(student._id);
          studentIds.add(student._id.toString());
        }

        studentsData.push({
          student_id: student._id,
          fullname: student.fullname,
          reg_no: student.reg_no,
          level: student.level,
          cgpa: student.cgpa,
          gpa: semesterResult.gpa,
          semester,
          session,
          courses: semesterResult.courses,
        });
        summary.processed += 1;
      } catch (err) {
        console.error(`Error processing reg_no ${reg_no}:`, err);
        summary.skipped += 1;
        pushSkip(summary.skipped_details, reg_no, "Unexpected error while processing row");
        continue;
      }
    }

    await classData.save();

    if (external) {
      const externalExists = await External.findOne({
        session,
        course_code: normalizedCourseCode,
      });
      if (!externalExists) {
        const newExternal = new External({
          session,
          course_code: normalizedCourseCode,
          course_title,
          unit_load,
          semester,
        });
        await newExternal.save();
        sessionData.externals.push(newExternal._id);
        await sessionData.save();
      }
    }

    res.status(200).json({
      message: "External students registered successfully",
      class: classData,
      students: studentsData,
      summary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error registering external students" });
  }
};

module.exports.add_score = async (req, res, next) => {
  let { students, session, semester, course_code } = req.body;
  semester = Number(semester);
  const normalizedCourseCode = normalizeCourseCode(course_code);
  const summary = {
    total_rows: Array.isArray(students) ? students.length : 0,
    processed: 0,
    skipped: 0,
    skipped_details: [],
  };

  if (!normalizedCourseCode || !session || !Number.isFinite(semester)) {
    return res.status(400).json({
      message: "course_code, session, and semester are required",
      summary,
    });
  }

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({
      message: "students must be a non-empty array",
      summary,
    });
  }

  try {
    const normalizedRows = students.map((studentData) => ({
      reg_no: normalizeRegNo(studentData?.reg_no),
      ca: Number(studentData?.ca),
      exam: Number(studentData?.exam),
    }));

    const regNos = [
      ...new Set(normalizedRows.map((row) => row.reg_no).filter(Boolean)),
    ];
    const studentRecords = await Student.find({ reg_no: { $in: regNos } });
    const studentRecordMap = new Map(
      studentRecords.map((student) => [normalizeRegNo(student.reg_no), student])
    );

    const bulkUpdates = [];
    const changedStudentIds = new Set();

    for (const row of normalizedRows) {
      try {
        const { reg_no, ca, exam } = row;
        if (!reg_no) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Missing reg_no");
          continue;
        }
        if (!Number.isFinite(ca) || !Number.isFinite(exam)) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Invalid ca/exam score");
          continue;
        }

        const student = studentRecordMap.get(reg_no);
        if (!student) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Student not found");
          continue;
        }

        let semesterResult = await SemesterResult.findOne({
          student_id: student._id,
          session,
          semester,
        });

        if (!semesterResult) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "No semester record found");
          continue;
        }

        let sessionResult = await SemesterResult.find({
          student_id: student._id,
          session,
        });

        if (!Array.isArray(sessionResult)) sessionResult = []; // Ensure it's iterable

        const course = semesterResult.courses.find(
          (c) => normalizeCourseCode(c.course_code) === normalizedCourseCode
        );

        if (!course) {
          summary.skipped += 1;
          pushSkip(summary.skipped_details, reg_no, "Course not registered for student");
          continue;
        }

        course.ca = ca;
        course.exam = exam;
        course.total = ca + exam;

        if (["pct224", "pct422"].includes(normalizedCourseCode)) {
          course.grade = await calculateGrade(course.total, "ceutics");
        } else if (normalizedCourseCode in professionals) {
          course.grade = await calculateGrade(course.total, "regular");
        } else {
          course.grade = await calculateGrade(course.total, "external");
        }

        semesterResult.gpa = Number(get_non_600_level_gpa(semesterResult));

        // Only calculate session_gpa if it's second semester AND sessionResult is available
        if (semester === 2 && sessionResult.length > 0) {
          const normalizedSessionResults = sessionResult.map((result) =>
            String(result._id) === String(semesterResult._id)
              ? semesterResult
              : result
          );
          semesterResult.session_gpa = Number(
            get_non_600_level_session_gpa(normalizedSessionResults)
          );
        }

        bulkUpdates.push({
          updateOne: {
            filter: { _id: semesterResult._id },
            update: {
              $set: {
                courses: semesterResult.courses,
                gpa: semesterResult.gpa,
                session_gpa: semesterResult.session_gpa || null,
              },
            },
          },
        });
        changedStudentIds.add(String(student._id));
        summary.processed += 1;
      } catch (err) {
        console.error(`Error processing student ${row.reg_no}:`, err);
        summary.skipped += 1;
        pushSkip(summary.skipped_details, row.reg_no, "Unexpected error while processing row");
      }
    }

    if (bulkUpdates.length > 0) {
      await SemesterResult.bulkWrite(bulkUpdates);
    }

    if (changedStudentIds.size > 0) {
      const changedStudents = await Student.find({
        _id: { $in: Array.from(changedStudentIds) },
      }).select("level");

      const studentUpdates = await Promise.all(
        changedStudents.map(async (currentStudent) => {
          const studentId = String(currentStudent._id);
          const cgpa = Number(await get_cgpa(studentId, Number(currentStudent.level)));
          return {
            updateOne: {
              filter: { _id: currentStudent._id },
              update: { $set: { cgpa } },
            },
          };
        })
      );

      if (studentUpdates.length > 0) {
        await Student.bulkWrite(studentUpdates);
      }
    }

    const message =
      summary.skipped > 0
        ? `Scores saved for ${summary.processed} student(s); ${summary.skipped} skipped.`
        : "Scores added successfully";

    res.status(200).json({ message, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error adding scores" });
  }
};

module.exports.get_class = async (req, res) => {
  const { class_id, semester, level, session } = req.body; // Expect class_id and semester

  try {
    const normalizedSemester = Number(semester);
    const normalizedLevel = Number(level);

    const foundClass = await Class.findById(class_id).populate("students").lean();

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    // Get student IDs from the class
    const studentIds = (foundClass.students || []).map(
      (student) => student?._id || student
    );

    if (studentIds.length === 0) {
      return res.status(200).json({
        success: true,
        class: foundClass,
        students: [],
      });
    }

    // Fetch only what we need and perform both reads in parallel.
    const [semesterResults, allSessionResults] = await Promise.all([
      SemesterResult.find({
        student_id: { $in: studentIds },
        session,
        semester: normalizedSemester,
        level: normalizedLevel,
      })
        .populate("student_id", "fullname reg_no level cgpa")
        .lean(),
      SemesterResult.find({
        student_id: { $in: studentIds },
        session,
      })
        .select("student_id courses")
        .lean(),
    ]);

    const sessionResultsByStudent = new Map();
    allSessionResults.forEach((result) => {
      const key = String(result.student_id);
      if (!sessionResultsByStudent.has(key)) {
        sessionResultsByStudent.set(key, []);
      }
      sessionResultsByStudent.get(key).push(result);
    });

    // Extract students with their results
    const students = semesterResults.map((result) => {
      const studentDoc = result.student_id || {};
      const studentKey = String(studentDoc._id || result.student_id);
      const sessionResults = sessionResultsByStudent.get(studentKey) || [];
      const computedSessionGpa = Number(
        get_non_600_level_session_gpa(sessionResults)
      );

      return {
        student_id: studentDoc._id,
        fullname: studentDoc.fullname,
        reg_no: studentDoc.reg_no,
        level: studentDoc.level,
        cgpa: studentDoc.cgpa,
        gpa: result.gpa,
        session_gpa: Number.isFinite(computedSessionGpa)
          ? computedSessionGpa
          : result.session_gpa,
        semester: result.semester,
        session: result.session,
        courses: result.courses, // Include their courses for the semester
      };
    });

    res.status(200).json({
      success: true,
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
  const normalizedCourseCode = normalizeCourseCode(course_code);
  const escapedCourseCode = normalizedCourseCode.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
  const courseCodeRegex = new RegExp(`^${escapedCourseCode}$`, "i");

  try {
    // Find all semester results that match the given session and semester
    const results = await SemesterResult.find({
      session,
      semester,
      "courses.course_code": courseCodeRegex,
    })
      .populate("student_id", "fullname reg_no")
      .lean();

    if (!results.length) {
      return res.status(404).json({
        message:
          "No students found for this course in the given session and semester",
      });
    }

    // Extract student details along with their course information
    const students = results
      .map((result) => {
      const student = result.student_id;
      const course = (result.courses || []).find(
        (c) => normalizeCourseCode(c.course_code) === normalizedCourseCode
      );

      if (!student || !course) return null;

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
      })
      .filter(Boolean);

    if (!students.length) {
      return res.status(404).json({
        message:
          "No students found for this course in the given session and semester",
      });
    }

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
      moe: result.student_id.moe,
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
  const { class_id } = req.body;

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

    const secondSemesterResults = await SemesterResult.find({
      student_id: { $in: studentIds },
      semester: 2, // Only check second semester
      session: { $in: sessions },
    })
      .select("student_id session level session_gpa courses")
      .sort("session")
      .lean();

    const resultsByStudent = new Map();
    secondSemesterResults.forEach((result) => {
      const key = String(result.student_id);
      if (!resultsByStudent.has(key)) {
        resultsByStudent.set(key, []);
      }
      resultsByStudent.get(key).push(result);
    });

    const errorStudents = [];

    for (const student of foundClass.students) {
      const studentResults = resultsByStudent.get(String(student._id)) || [];

      let probationSessions = [];
      let probationDetails = [];

      for (const result of studentResults) {
        if (result.level === 100) {
          const courseAverages = {};

          for (const course of result.courses) {
            const match = String(course.course_code || "").match(/^[a-zA-Z]+/);
            if (!match) continue;
            const prefix = match[0];
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
          moe: student.moe,
        });
      }
    }

    res.status(200).json({ success: true, students: errorStudents });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error retrieving error students" });
  }
};

const parseSessionYear = (session) => {
  const match = /^(\d{4})/.exec(session || "");
  return match ? Number(match[1]) : null;
};

const compareSessions = (a, b) => {
  const aYear = parseSessionYear(a);
  const bYear = parseSessionYear(b);

  if (aYear !== null && bYear !== null && aYear !== bYear) {
    return aYear - bYear;
  }

  return String(a).localeCompare(String(b));
};

module.exports.finalists = async (req, res) => {
  try {
    const finalists = await Student.find({ level: 600 });

    if (!finalists.length) {
      return res.status(200).json({ sessions: [], students: [] });
    }

    const studentIds = finalists.map((student) => student._id);

    const results = await SemesterResult.find({
      student_id: { $in: studentIds },
      level: { $gte: 200, $lte: 600 },
    }).populate("student_id");

    const sessions = Array.from(
      new Set(results.map((result) => result.session))
    ).sort(compareSessions);
    const sessionIndex = new Map(
      sessions.map((session, index) => [session, index])
    );

    const resultsByStudent = new Map();
    results.forEach((result) => {
      if (!result.student_id) return;
      const key = result.student_id._id.toString();
      if (!resultsByStudent.has(key)) {
        resultsByStudent.set(key, []);
      }
      resultsByStudent.get(key).push(result);
    });

    const students = finalists
      .map((student) => {
        const studentResults = resultsByStudent.get(student._id.toString()) || [];
        const attemptsByCourse = new Map();

        studentResults.forEach((result) => {
          const session = result.session;
          const semester = Number(result.semester) || 0;
          const level = Number(result.level) || 0;
          const sessionOrder = sessionIndex.get(session) ?? 0;

          result.courses.forEach((course) => {
            if (!course?.course_code) return;

            const total = Number(course.total) || 0;
            const ca = Number(course.ca) || 0;
            const exam = Number(course.exam) || 0;
            const isMissingResult = total === 0 && ca === 0 && exam === 0;

            const codeKey = String(course.course_code).toLowerCase().trim();
            if (!Object.prototype.hasOwnProperty.call(professionals, codeKey)) {
              return;
            }
            const attempt = {
              course_code: course.course_code,
              grade: Number(course.grade) || 0,
              session,
              semester,
              level,
              session_order: sessionOrder,
              missing_result: isMissingResult,
            };

            if (!attemptsByCourse.has(codeKey)) {
              attemptsByCourse.set(codeKey, []);
            }
            attemptsByCourse.get(codeKey).push(attempt);
          });
        });

        const issuesBySession = new Map();

        attemptsByCourse.forEach((attempts) => {
          attempts.sort((a, b) => {
            if (a.session_order !== b.session_order) {
              return a.session_order - b.session_order;
            }
            return a.semester - b.semester;
          });

          const lastAttempt = attempts[attempts.length - 1];
          if (!lastAttempt || lastAttempt.grade !== 0) return;

          if (!issuesBySession.has(lastAttempt.session)) {
            issuesBySession.set(lastAttempt.session, new Map());
          }
          const levelMap = issuesBySession.get(lastAttempt.session);
          if (!levelMap.has(lastAttempt.level)) {
            levelMap.set(lastAttempt.level, new Map());
          }

          const issueType = lastAttempt.missing_result
            ? "missing_result"
            : attempts.length > 1
            ? "rewrote_still_failed"
            : "failed_not_rewritten";

          levelMap.get(lastAttempt.level).set(lastAttempt.course_code, {
            issue_type: issueType,
            semester: lastAttempt.semester,
          });
        });

        const issues_by_session = {};
        issuesBySession.forEach((levelMap, session) => {
          issues_by_session[session] = Array.from(levelMap.entries()).map(
            ([level, coursesMap]) => ({
              level,
              courses: Array.from(coursesMap.keys()),
              details: Array.from(coursesMap.entries()).map(
                ([course_code, meta]) => ({
                  course_code,
                  ...meta,
                })
              ),
            })
          );
        });

        if (Object.keys(issues_by_session).length === 0) {
          return null;
        }

        return {
          student_id: student._id,
          fullname: student.fullname,
          reg_no: student.reg_no,
          issues_by_session,
        };
      })
      .filter(Boolean);

    res.status(200).json({ sessions, students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching finalists" });
  }
};

module.exports.outstanding_failed_courses = async (req, res) => {
  const { class_id } = req.body;

  if (!class_id) {
    return res.status(400).json({ message: "class_id is required" });
  }

  try {
    const foundClass = await Class.findById(class_id).populate("students");
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    if (foundClass.level < 200 || foundClass.level > 600) {
      return res.status(400).json({
        message: "Outstanding list is available for 200 to 600 level classes.",
      });
    }

    const studentIds = foundClass.students.map((student) => student._id);

    const results = await SemesterResult.find({
      student_id: { $in: studentIds },
      level: { $gte: 200, $lte: 600 },
    }).populate("student_id");

    const sessions = Array.from(
      new Set(results.map((result) => result.session))
    ).sort(compareSessions);
    const sessionIndex = new Map(
      sessions.map((session, index) => [session, index])
    );

    const resultsByStudent = new Map();
    results.forEach((result) => {
      if (!result.student_id) return;
      const key = result.student_id._id.toString();
      if (!resultsByStudent.has(key)) {
        resultsByStudent.set(key, []);
      }
      resultsByStudent.get(key).push(result);
    });

    const students = foundClass.students
      .map((student) => {
        const studentResults =
          resultsByStudent.get(student._id.toString()) || [];
        const attemptsByCourse = new Map();

        studentResults.forEach((result) => {
          const session = result.session;
          const semester = Number(result.semester) || 0;
          const level = Number(result.level) || 0;
          const sessionOrder = sessionIndex.get(session) ?? 0;

          result.courses.forEach((course) => {
            if (!course?.course_code) return;

            const total = Number(course.total) || 0;
            const ca = Number(course.ca) || 0;
            const exam = Number(course.exam) || 0;
            const isMissingResult = total === 0 && ca === 0 && exam === 0;

            const codeKey = String(course.course_code).toLowerCase().trim();
            if (!Object.prototype.hasOwnProperty.call(professionals, codeKey)) {
              return;
            }
            const attempt = {
              course_code: course.course_code,
              grade: Number(course.grade) || 0,
              session,
              semester,
              level,
              session_order: sessionOrder,
              missing_result: isMissingResult,
            };

            if (!attemptsByCourse.has(codeKey)) {
              attemptsByCourse.set(codeKey, []);
            }
            attemptsByCourse.get(codeKey).push(attempt);
          });
        });

        const issuesBySession = new Map();

        attemptsByCourse.forEach((attempts) => {
          attempts.sort((a, b) => {
            if (a.session_order !== b.session_order) {
              return a.session_order - b.session_order;
            }
            return a.semester - b.semester;
          });

          const lastAttempt = attempts[attempts.length - 1];
          if (!lastAttempt || lastAttempt.grade !== 0) return;

          if (!issuesBySession.has(lastAttempt.session)) {
            issuesBySession.set(lastAttempt.session, new Map());
          }
          const levelMap = issuesBySession.get(lastAttempt.session);
          if (!levelMap.has(lastAttempt.level)) {
            levelMap.set(lastAttempt.level, new Map());
          }

          const issueType = lastAttempt.missing_result
            ? "missing_result"
            : attempts.length > 1
            ? "rewrote_still_failed"
            : "failed_not_rewritten";

          levelMap.get(lastAttempt.level).set(lastAttempt.course_code, {
            issue_type: issueType,
            semester: lastAttempt.semester,
          });
        });

        const issues_by_session = {};
        issuesBySession.forEach((levelMap, session) => {
          issues_by_session[session] = Array.from(levelMap.entries()).map(
            ([level, coursesMap]) => ({
              level,
              courses: Array.from(coursesMap.keys()),
              details: Array.from(coursesMap.entries()).map(
                ([course_code, meta]) => ({
                  course_code,
                  ...meta,
                })
              ),
            })
          );
        });

        if (Object.keys(issues_by_session).length === 0) {
          return null;
        }

        return {
          student_id: student._id,
          fullname: student.fullname,
          reg_no: student.reg_no,
          issues_by_session,
        };
      })
      .filter(Boolean);

    res.status(200).json({
      class: { id: foundClass._id, level: foundClass.level },
      sessions,
      students,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching outstanding courses" });
  }
};

module.exports.temp600ThreeCourseAverage = async (req, res) => {
  const sessionLabel = String(req.query.session || "2024-2025").trim();
  const targetLevel = 600;
  const targetCourses = ["ced341", "ced342", "cpm561"];

  try {
    const sessionData = await Session.findOne({ session: sessionLabel }).populate(
      "classes"
    );
    if (!sessionData) {
      return res.status(404).json({ message: "Session not found" });
    }

    const levelClass = (sessionData.classes || []).find(
      (classItem) => Number(classItem.level) === targetLevel
    );
    if (!levelClass) {
      return res.status(404).json({
        message: `${targetLevel} level class not found in ${sessionLabel} session`,
      });
    }

    const foundClass = await Class.findById(levelClass._id).populate("students");
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const studentsInClass = foundClass.students || [];
    const studentIds = studentsInClass.map((student) => student._id);

    const results = await SemesterResult.find({
      student_id: { $in: studentIds },
    }).populate("student_id");

    const orderedSessions = Array.from(
      new Set(results.map((result) => String(result.session || "")))
    ).sort(compareSessions);
    const sessionOrderMap = new Map(
      orderedSessions.map((session, index) => [session, index])
    );

    const studentsMap = new Map();
    studentsInClass.forEach((student) => {
      studentsMap.set(String(student._id), {
        student_id: student._id,
        fullname: student.fullname,
        reg_no: student.reg_no,
        attempts: {},
      });
    });

    results.forEach((result) => {
      const studentRef = result.student_id;
      const studentId = String(studentRef?._id || result.student_id);
      if (!studentsMap.has(studentId)) return;

      const semesterOrder = Number(result.semester) || 0;
      const studentData = studentsMap.get(studentId);

      (result.courses || []).forEach((course) => {
        const code = String(course?.course_code || "").toLowerCase().trim();
        if (!targetCourses.includes(code)) return;

        const total = Number(course.total);
        const ca = Number(course.ca) || 0;
        const exam = Number(course.exam) || 0;
        const resolvedTotal = Number.isFinite(total) ? total : ca + exam;
        const score = Number.isFinite(resolvedTotal) ? resolvedTotal : 0;

        const previousAttempt = studentData.attempts[code];
        const currentSessionOrder =
          sessionOrderMap.get(String(result.session || "")) ?? -1;
        const previousSessionOrder = previousAttempt?.session_order ?? -1;
        const shouldReplace =
          !previousAttempt ||
          currentSessionOrder > previousSessionOrder ||
          (currentSessionOrder === previousSessionOrder &&
            semesterOrder >= previousAttempt.semester);

        if (shouldReplace) {
          studentData.attempts[code] = {
            score,
            semester: semesterOrder,
            session_order: currentSessionOrder,
          };
        }
      });
    });

    const courseTotals = {
      ced341: 0,
      ced342: 0,
      cpm561: 0,
    };

    const students = Array.from(studentsMap.values()).map((studentData) => {
      const scores = {
        ced341: Number(studentData.attempts.ced341?.score) || 0,
        ced342: Number(studentData.attempts.ced342?.score) || 0,
        cpm561: Number(studentData.attempts.cpm561?.score) || 0,
      };

      courseTotals.ced341 += scores.ced341;
      courseTotals.ced342 += scores.ced342;
      courseTotals.cpm561 += scores.cpm561;

      const average = (scores.ced341 + scores.ced342 + scores.cpm561) / 3;

      return {
        student_id: studentData.student_id,
        fullname: studentData.fullname,
        reg_no: studentData.reg_no,
        scores,
        average: Number(average.toFixed(2)),
      };
    });

    students.sort((a, b) => {
      if (b.average !== a.average) return b.average - a.average;
      return String(a.fullname || "").localeCompare(String(b.fullname || ""));
    });

    const totalStudents = students.length;
    const classAverage =
      totalStudents > 0
        ? Number(
            (
              students.reduce((sum, student) => sum + student.average, 0) /
              totalStudents
            ).toFixed(2)
          )
        : 0;

    const courseAverages = {
      ced341:
        totalStudents > 0 ? Number((courseTotals.ced341 / totalStudents).toFixed(2)) : 0,
      ced342:
        totalStudents > 0 ? Number((courseTotals.ced342 / totalStudents).toFixed(2)) : 0,
      cpm561:
        totalStudents > 0 ? Number((courseTotals.cpm561 / totalStudents).toFixed(2)) : 0,
    };

    res.status(200).json({
      session: sessionLabel,
      level: targetLevel,
      course_codes: targetCourses,
      total_students: totalStudents,
      class_average: classAverage,
      course_averages: courseAverages,
      highest_student: students[0] || null,
      students,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching temporary 600-level average" });
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

const updateGrades = async () => {
  try {
    console.log("Updating grades for all students...");

    // Fetch all semester results
    const results = await SemesterResult.find();

    if (!results.length) {
      console.log("No results found.");
      return;
    }

    // Loop through each result
    for (let result of results) {
      for (let course of result.courses) {
        if (["pct224", "pct422"].includes(course.course_code.toLowerCase())) {
          course.grade = await calculateGrade(course.total, "ceutics");
        } else if (course.course_code.toLowerCase() in professionals) {
          course.grade = await calculateGrade(course.total, "regular");
        } else {
          course.grade = await calculateGrade(course.total, "external");
        }
      }

      await result.save(); // Save updated result
    }

    console.log("Grades updated successfully.");
  } catch (error) {
    console.error("Error updating grades:", error);
  }
};

// updateGrades()

module.exports.getTopStudents = async (req, res) => {
  const { class_id } = req.params; // Get class_id from request body
  const limit = Number(req.query.limit) || 10;

  try {
    // Find the class by ID and populate students
    const foundClass = await Class.findById(class_id).populate("students");

    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    // Sort students by CGPA in descending order and get the top 10
    const topStudents = foundClass.students
      .sort((a, b) => b.cgpa - a.cgpa)
      .slice(0, limit)
      .map((student) => ({
        reg_no: student.reg_no,
        fullname: student.fullname,
        cgpa: student.cgpa,
      }));

    res.status(200).json({ topStudents });
  } catch (error) {
    console.error("Error fetching top students:", error);
    res.status(500).json({ message: "Error fetching top students" });
  }
};

module.exports.getTopStudentsByDepartment = async (req, res) => {
  const { class_id } = req.params;
  const { department_id } = req.body;
  const limit = Number(req.query.limit) || 10;

  if (!class_id || !department_id) {
    return res.status(400).json({ message: "class_id and department_id are required" });
  }

  try {
    const foundClass = await Class.findById(class_id).populate("students");
    if (!foundClass) {
      return res.status(404).json({ message: "Class not found" });
    }

    const studentIds = foundClass.students.map((student) => student._id);
    const results = await SemesterResult.find({
      student_id: { $in: studentIds },
      level: { $gte: 200, $lte: foundClass.level },
    }).populate("student_id");

    const resultsByStudent = new Map();
    results.forEach((result) => {
      if (!result.student_id) return;
      const key = result.student_id._id.toString();
      if (!resultsByStudent.has(key)) {
        resultsByStudent.set(key, []);
      }
      resultsByStudent.get(key).push(result);
    });

    const deptId = String(department_id);
    const deptPrefixes = {
      "1": ["pti"],
      "2": ["pct"],
      "3": ["pch"],
      "4": ["pcg"],
      "5": ["pcl"],
      "6": ["cpm"],
      "7": ["pmb"],
      "8": ["cpm"],
      "9": ["paa"],
    };

    const topStudents = foundClass.students
      .map((student) => {
        const studentResults = resultsByStudent.get(student._id.toString()) || [];
        let totalScores = 0;
        let courseCount = 0;

        studentResults.forEach((result) => {
          result.courses.forEach((course) => {
            if (!course?.course_code) return;
            const code = course.course_code.toLowerCase();
            if (!(code in professionals)) return;

            const prefixes = deptPrefixes[deptId] || [];
            if (prefixes.length > 0) {
              if (!prefixes.some((prefix) => code.startsWith(prefix))) return;
            } else {
              const match = code.match(/(\d+)\s*$/);
              if (!match) return;
              const lastDigit = match[1][match[1].length - 1];
              if (lastDigit !== deptId) return;
            }

            const score =
              course.total !== undefined && course.total !== null
                ? Number(course.total)
                : Number(course.grade);
            if (!Number.isFinite(score)) return;
            totalScores += score;
            courseCount += 1;
          });
        });

        if (courseCount === 0) {
          return null;
        }

        const deptGpa = totalScores / courseCount;
        return {
          reg_no: student.reg_no,
          fullname: student.fullname,
          cgpa: student.cgpa,
          department_gpa: Number(deptGpa.toFixed(2)),
          total_courses: courseCount,
          total_score: totalScores,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.department_gpa - a.department_gpa)
      .slice(0, limit);

    res.status(200).json({ topStudents });
  } catch (error) {
    console.error("Error fetching top students by department:", error);
    res.status(500).json({ message: "Error fetching top students by department" });
  }
};

module.exports.findDuplicates = async (req, res) => {
  try {
    // Find exact duplicates
    const exactDuplicates = await Student.aggregate([
      {
        $group: {
          _id: "$reg_no",
          count: { $sum: 1 },
          studentIds: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    const duplicateDetails = [];

    // Process exact duplicates
    for (let duplicate of exactDuplicates) {
      const profiles = await Student.find({ _id: { $in: duplicate.studentIds } });
      const profilesWithDetails = [];

      for (let profile of profiles) {
        const semesterResults = await SemesterResult.find({ student_id: profile._id });
        const totalCourses = semesterResults.reduce((sum, res) => sum + res.courses.length, 0);

        profilesWithDetails.push({
          _id: profile._id,
          fullname: profile.fullname,
          reg_no: profile.reg_no,
          level: profile.level,
          cgpa: profile.cgpa,
          totalSemesters: semesterResults.length,
          totalCourses,
        });
      }

      duplicateDetails.push({
        reg_no: duplicate._id,
        count: duplicate.count,
        profiles: profilesWithDetails,
      });
    }

    // Find whitespace-based duplicates
    const allStudents = await Student.find();
    const trimmedMap = new Map();

    for (let student of allStudents) {
      const trimmed = student.reg_no.trim();
      if (!trimmedMap.has(trimmed)) {
        trimmedMap.set(trimmed, []);
      }
      trimmedMap.get(trimmed).push(student._id);
    }

    // Process whitespace duplicates
    for (let [trimmedRegNo, studentIds] of trimmedMap) {
      if (studentIds.length > 1) {
        const profiles = await Student.find({ _id: { $in: studentIds } });
        const profilesWithDetails = [];

        for (let profile of profiles) {
          const semesterResults = await SemesterResult.find({ student_id: profile._id });
          const totalCourses = semesterResults.reduce((sum, res) => sum + res.courses.length, 0);

          profilesWithDetails.push({
            _id: profile._id,
            fullname: profile.fullname,
            reg_no: profile.reg_no,
            level: profile.level,
            cgpa: profile.cgpa,
            totalSemesters: semesterResults.length,
            totalCourses,
          });
        }

        duplicateDetails.push({
          reg_no: trimmedRegNo,
          count: studentIds.length,
          profiles: profilesWithDetails,
        });
      }
    }

    res.status(200).json({ duplicates: duplicateDetails });
  } catch (error) {
    console.error("Error finding duplicates:", error);
    res.status(500).json({ message: "Error finding duplicates", error: error.message });
  }
};

module.exports.mergeSpecificDuplicate = async (req, res) => {
  try {
    const { keepId, deleteIds } = req.body;

    if (!keepId || !deleteIds || !Array.isArray(deleteIds)) {
      return res.status(400).json({ message: "keepId and deleteIds array are required" });
    }

    const mainStudent = await Student.findById(keepId);
    if (!mainStudent) {
      return res.status(404).json({ message: "Selected profile not found" });
    }

    for (let deleteId of deleteIds) {
      const duplicateStudent = await Student.findById(deleteId);
      if (!duplicateStudent) continue;

      const duplicateResults = await SemesterResult.find({ student_id: deleteId });

      for (let result of duplicateResults) {
        const existingResult = await SemesterResult.findOne({
          student_id: keepId,
          session: result.session,
          semester: result.semester,
        });

        if (existingResult) {
          for (let course of result.courses) {
            if (!existingResult.courses.some((c) => c.course_code === course.course_code)) {
              existingResult.courses.push(course);
            }
          }
          await existingResult.save();
        } else {
          result.student_id = keepId;
          await result.save();
        }
      }

      await Student.deleteOne({ _id: deleteId });
    }

    res.status(200).json({
      message: `Successfully merged ${deleteIds.length} duplicate profile(s)`,
      merged: deleteIds.length,
    });
  } catch (error) {
    console.error("Error merging specific duplicate:", error);
    res.status(500).json({ message: "Error merging duplicate", error: error.message });
  }
};

module.exports.mergeDuplicateStudents = async (req, res) => {
  try {
    console.log("Starting student cleanup...");

    // Step 1: Normalize all reg_no values (trim spaces)
    const students = await Student.find();
    let normalizedCount = 0;
    
    for (let student of students) {
      const trimmedRegNo = student.reg_no.trim();
      if (trimmedRegNo !== student.reg_no) {
        const existingStudent = await Student.findOne({ reg_no: trimmedRegNo });

        if (!existingStudent) {
          await Student.updateOne(
            { _id: student._id },
            { reg_no: trimmedRegNo }
          );
          normalizedCount++;
        }
      }
    }

    console.log("Reg_no normalization complete.");

    // Step 2: Find duplicate students based on trimmed reg_no
    const duplicates = await Student.aggregate([
      {
        $group: {
          _id: "$reg_no",
          count: { $sum: 1 },
          studentIds: { $push: "$_id" },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ]);

    if (duplicates.length === 0) {
      console.log("No duplicate students found.");
      return res.status(200).json({
        message: "No duplicate students found",
        normalized: normalizedCount,
        merged: 0,
      });
    }

    console.log(`Found ${duplicates.length} duplicate reg_no entries.`);
    let mergedCount = 0;

    // Step 3: Merge students
    for (let duplicate of duplicates) {
      const { _id: reg_no, studentIds } = duplicate;

      console.log(`Processing duplicates for reg_no: ${reg_no}`);

      const studentProfiles = await Student.find({ _id: { $in: studentIds } });

      // Find the student with most semester results
      let mainStudent = studentProfiles[0];
      let maxResults = 0;

      for (let student of studentProfiles) {
        const results = await SemesterResult.find({ student_id: student._id });
        const totalCourses = results.reduce((sum, res) => sum + res.courses.length, 0);
        
        if (results.length > maxResults || (results.length === maxResults && totalCourses > 0)) {
          maxResults = results.length;
          mainStudent = student;
        }
      }

      const duplicateStudents = studentProfiles.filter(s => s._id.toString() !== mainStudent._id.toString());

      console.log(`Keeping student: ${mainStudent._id}, Merging ${duplicateStudents.length} duplicates`);

      // Step 4: Merge semester results before deleting
      for (let duplicateStudent of duplicateStudents) {
        const duplicateResults = await SemesterResult.find({
          student_id: duplicateStudent._id,
        });

        for (let result of duplicateResults) {
          const existingResult = await SemesterResult.findOne({
            student_id: mainStudent._id,
            session: result.session,
            semester: result.semester,
          });

          if (existingResult) {
            for (let course of result.courses) {
              if (!existingResult.courses.some((c) => c.course_code === course.course_code)) {
                existingResult.courses.push(course);
              }
            }
            await existingResult.save();
          } else {
            result.student_id = mainStudent._id;
            await result.save();
          }
        }

        await Student.deleteOne({ _id: duplicateStudent._id });
        console.log(`Deleted duplicate student: ${duplicateStudent._id}`);
        mergedCount++;
      }
    }

    console.log("Merging complete.");
    res.status(200).json({
      message: "Duplicate students merged successfully",
      normalized: normalizedCount,
      merged: mergedCount,
      duplicatesFound: duplicates.length,
    });
  } catch (error) {
    console.error("Error merging students:", error);
    res.status(500).json({ message: "Error merging students", error: error.message });
  }
};

const cleanUpGSP208Results = async () => {
  try {
    console.log("Starting cleanup for 2020-2021 Second Semester...");

    // Step 1: Find all semester results for 2020-2021 Second Semester
    const targetResults = await SemesterResult.find({
      session: "2020-2021",
      semester: 2,
    });

    console.log(`Total results found: ${targetResults.length}`);

    for (let result of targetResults) {
      if (
        result.courses.length === 1 &&
        result.courses[0].course_code.toLowerCase() === "gsp208"
      ) {
        console.log(
          `Deleting semester result for student: ${result.student_id}`
        );

        // Step 2: Delete the semester result
        await SemesterResult.deleteOne({ _id: result._id });

        // Step 3: Check if the student has any other semester results
        const remainingResults = await SemesterResult.find({
          student_id: result.student_id,
        });

        if (remainingResults.length === 0) {
          // If the student has no other semester results, delete the student profile
          console.log(`Deleting student profile: ${result.student_id}`);
          await Student.deleteOne({ _id: result.student_id });
        }
      }
    }

    console.log("Cleanup completed successfully.");
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
};

// Run the function
// cleanUpGSP208Results();

const updateSemesterGPAs = async () => {
  try {
    console.log("Starting GPA updates...");

    // Fetch all semester results
    const results = await SemesterResult.find();

    if (!results.length) {
      console.log("No semester results found.");
      return;
    }

    for (let result of results) {
      let totalUnits = 0;
      let totalPoints = 0;

      const approvedCourses = filterApprovedCourses(result.courses);
      
      for (let course of approvedCourses) {
        const unit = course.unit_load || 0;
        const grade = course.grade || 0;

        totalUnits += unit;
        totalPoints += unit * grade;
      }

      result.gpa = totalUnits > 0 ? totalPoints / totalUnits : 0;
      await result.save();
    }

    console.log("Semester GPA update completed.");
  } catch (error) {
    console.error("Error updating semester GPAs:", error);
  }
};

// updateSemesterGPAs();

const calculateSessionGPA = async () => {
  try {
    console.log("Calculating session GPA...");

    // Group semester results by student and session
    const groupedResults = await SemesterResult.aggregate([
      {
        $group: {
          _id: { student_id: "$student_id", session: "$session" },
          results: { $push: "$$ROOT" },
        },
      },
    ]);

    for (const entry of groupedResults) {
      const { student_id, session } = entry._id;
      const semesterResults = entry.results;

      let totalPoints = 0;
      let totalUnits = 0;
      let secondSemesterId = null;

      for (const result of semesterResults) {
        if (result.semester === 2) secondSemesterId = result._id;

        const approvedCourses = filterApprovedCourses(result.courses);
        
        for (const course of approvedCourses) {
          const gradePoint = course.grade;
          const unit = course.unit_load;

          totalPoints += gradePoint * unit;
          totalUnits += unit;
        }
      }

      if (secondSemesterId && totalUnits > 0) {
        const session_gpa = totalPoints / totalUnits;

        await SemesterResult.findByIdAndUpdate(secondSemesterId, {
          session_gpa: session_gpa.toFixed(2),
        });
      }
    }

    console.log("Session GPA calculation completed.");
  } catch (err) {
    console.error("Error calculating session GPA:", err.message);
  }
};

// calculateSessionGPA();

async function updateAllStudentsCGPA() {
  try {
    const students = await Student.find();

    for (const student of students) {
      const results = await SemesterResult.find({ student_id: student._id });

      let totalUnits = 0;
      let totalPoints = 0;

      for (const result of results) {
        const approvedCourses = filterApprovedCourses(result.courses);
        
        for (const course of approvedCourses) {
          totalUnits += course.unit_load;
          totalPoints += course.unit_load * course.grade;
        }
      }

      const cgpa = totalUnits > 0 ? totalPoints / totalUnits : 0;

      await Student.updateOne({ _id: student._id }, { $set: { cgpa: cgpa } });
    }

    console.log("CGPA updated for all students.");
  } catch (error) {
    console.error("Error updating CGPA:", error);
  }
}

// updateAllStudentsCGPA();

module.exports.trimAllRegNos = async (req, res) => {
  try {
    const students = await Student.find();
    let trimmedCount = 0;
    let deletedCount = 0;
    let keptCount = 0;
    const keptProfiles = [];

    for (let student of students) {
      const trimmedRegNo = student.reg_no.trim();
      if (trimmedRegNo !== student.reg_no) {
        const existingStudent = await Student.findOne({ reg_no: trimmedRegNo });
        if (existingStudent) {
          // Count total courses for this profile
          const semesterResults = await SemesterResult.find({ student_id: student._id });
          const totalCourses = semesterResults.reduce((sum, res) => sum + res.courses.length, 0);
          
          if (totalCourses <= 2) {
            // Delete profile with 2 or fewer courses
            await SemesterResult.deleteMany({ student_id: student._id });
            await Student.deleteOne({ _id: student._id });
            deletedCount++;
          } else {
            // Keep this profile, it has more than 2 courses
            keptCount++;
            keptProfiles.push({
              _id: student._id,
              reg_no: student.reg_no,
              reg_no_length: student.reg_no.length,
              trimmed_reg_no: trimmedRegNo,
              fullname: student.fullname,
              totalCourses,
            });
          }
        } else {
          student.reg_no = trimmedRegNo;
          await student.save();
          trimmedCount++;
        }
      }
    }

    res.status(200).json({
      message: "All reg_no values processed successfully",
      totalStudents: students.length,
      trimmedCount,
      deletedCount,
      keptCount,
      keptProfiles: keptProfiles.slice(0, 5),
    });
  } catch (error) {
    console.error("Error trimming reg_no:", error);
    res.status(500).json({ message: "Error trimming reg_no", error: error.message });
  }
};
