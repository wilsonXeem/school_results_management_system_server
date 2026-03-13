const SemesterResult = require("../models/semester_result");
const Student = require("../models/student");
const professionals = require("./professionals");
const external = require("./external");

const hasCourseCode = (catalog = {}, courseCode = "") => {
  const code = String(courseCode).toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(catalog, code);
};

// Function to check if a course is approved for GPA calculation
const isApprovedCourse = (courseCode = "") => {
  return hasCourseCode(professionals, courseCode) || hasCourseCode(external, courseCode);
};

// Function to filter approved courses
const filterApprovedCourses = (courses) => {
  return (Array.isArray(courses) ? courses : []).filter((course) =>
    isApprovedCourse(course.course_code)
  );
};

const getSafeCourseTotals = (
  courses = [],
  { approvedOnly = false, includeCourse = null } = {}
) => {
  let totalPoints = 0;
  let totalUnits = 0;
  const normalizedCourses = Array.isArray(courses) ? courses : [];

  let sourceCourses = approvedOnly
    ? filterApprovedCourses(normalizedCourses)
    : normalizedCourses;
  if (typeof includeCourse === "function") {
    sourceCourses = sourceCourses.filter(includeCourse);
  }

  sourceCourses.forEach((course) => {
    const grade = Number(course?.grade);
    const unitLoad = Number(course?.unit_load);

    // Include all registered courses and treat missing/invalid grade as 0.
    const safeGrade = Number.isFinite(grade) ? grade : 0;
    if (!Number.isFinite(unitLoad) || unitLoad <= 0) return;

    totalPoints += safeGrade * unitLoad;
    totalUnits += unitLoad;
  });

  return { totalPoints, totalUnits };
};

const formatGpa = (totalPoints, totalUnits) => {
  return totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : 0;
};

// Function to calculate grade based on score
const calculateGrade = (score, type) => {
  if (type === "regular") {
    if (score >= 69.49) return 5;
    else if (score >= 59.49) return 4;
    else if (score >= 49.49) return 3;
    else return 0;
  } else if (type === "external") {
    if (score >= 69.49) return 5;
    else if (score >= 59.49) return 4;
    else if (score >= 49.49) return 3;
    else if (score >= 44.49) return 2;
    else if (score >= 39.49) return 1;
    else return 0;
  } else if (type === "ceutics") {
    if (score >= 69.49) return 5;
    else if (score >= 59.49) return 4;
    else return 0;
  } else {
    throw new Error("Invalid grade type provided");
  }
};

// Function to calculate GPA for a semester
const get_non_600_level_gpa = (semesterResult) => {
  const { totalPoints, totalUnits } = getSafeCourseTotals(
    semesterResult?.courses || []
  );
  return formatGpa(totalPoints, totalUnits);
};

const get_600_level_gpa = (semesterResult) => {
  // Kept separate so 600-level rules can evolve independently if needed.
  const { totalPoints, totalUnits } = getSafeCourseTotals(
    semesterResult?.courses || []
  );
  return formatGpa(totalPoints, totalUnits);
};

const get_gpa = (semesterResult) => {
  const level = Number(semesterResult?.level);
  return level === 600
    ? get_600_level_gpa(semesterResult)
    : get_non_600_level_gpa(semesterResult);
};

// Function to calculate GPA for a session
const get_non_600_level_session_gpa = (session = []) => {
  let totalPoints = 0;
  let totalUnits = 0;

  for (const semesterResult of session) {
    const totals = getSafeCourseTotals(semesterResult?.courses || []);
    totalPoints += totals.totalPoints;
    totalUnits += totals.totalUnits;
  }

  return formatGpa(totalPoints, totalUnits);
};

const get_600_level_session_gpa = (session = []) => {
  // Kept separate so 600-level rules can evolve independently if needed.
  let totalPoints = 0;
  let totalUnits = 0;

  for (const semesterResult of session) {
    const totals = getSafeCourseTotals(semesterResult?.courses || []);
    totalPoints += totals.totalPoints;
    totalUnits += totals.totalUnits;
  }

  return formatGpa(totalPoints, totalUnits);
};

const get_session_gpa = (session = [], level) => {
  const resolvedLevel = Number.isFinite(Number(level))
    ? Number(level)
    : Number(session?.[0]?.level);

  return resolvedLevel === 600
    ? get_600_level_session_gpa(session)
    : get_non_600_level_session_gpa(session);
};

// Function to calculate CGPA for a student
const get_cgpa = async (student_id, level) => {
  const semesterResults = await SemesterResult.find({ student_id });

  if (!semesterResults || semesterResults.length === 0) {
    console.log("No semester results found for student:", student_id);
    return 0; // No results, CGPA should be 0
  }

  let totalPoints = 0;
  let totalUnits = 0;
  let resolvedLevel = Number(level);
  if (!Number.isFinite(resolvedLevel)) {
    const student = await Student.findById(student_id).select("level");
    resolvedLevel = Number(student?.level);
  }

  const is600Level = resolvedLevel === 600;

  semesterResults.forEach((semester) => {
    if (!semester.courses || semester.courses.length === 0) {
      console.log(`No courses found for semester: ${semester._id}`);
      return; // Skip this semester if no courses
    }

    const totals = is600Level
      ? getSafeCourseTotals(semester.courses, {
          approvedOnly: true,
        })
      : getSafeCourseTotals(semester.courses);
    totalPoints += totals.totalPoints;
    totalUnits += totals.totalUnits;
  });

  return formatGpa(totalPoints, totalUnits);
};

module.exports = {
  calculateGrade,
  get_gpa,
  get_non_600_level_gpa,
  get_600_level_gpa,
  get_session_gpa,
  get_non_600_level_session_gpa,
  get_600_level_session_gpa,
  get_cgpa,
  isApprovedCourse,
  filterApprovedCourses,
};
