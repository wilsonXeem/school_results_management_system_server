const SemesterResult = require("../models/semester_result");
const professionals = require("./professionals");
const external = require("./external");

// Function to check if a course is approved for GPA calculation
const isApprovedCourse = (courseCode) => {
  const code = courseCode.toLowerCase();
  return code in professionals || code in external;
};

// Function to filter approved courses
const filterApprovedCourses = (courses) => {
  return courses.filter(course => isApprovedCourse(course.course_code));
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
const get_gpa = (semesterResult) => {
  let totalPoints = 0;
  let totalUnits = 0;

  const approvedCourses = filterApprovedCourses(semesterResult.courses);
  
  approvedCourses.forEach((course) => {
    totalPoints += course.grade * course.unit_load;
    totalUnits += course.unit_load;
  });

  return totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : 0;
};

// Function to calculate GPA for a session
const get_session_gpa = (session) => {
  let totalPoints = 0;
  let totalUnits = 0;

  for (const semesterResult of session) {
    const approvedCourses = filterApprovedCourses(semesterResult?.courses || []);
    
    approvedCourses.forEach((course) => {
      totalPoints += course.grade * course.unit_load;
      totalUnits += course.unit_load;
    });
  }

  return totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : 0;
};

// Function to calculate CGPA for a student
const get_cgpa = async (student_id) => {
  const semesterResults = await SemesterResult.find({ student_id });

  if (!semesterResults || semesterResults.length === 0) {
    console.log("No semester results found for student:", student_id);
    return 0; // No results, CGPA should be 0
  }

  let totalPoints = 0;
  let totalUnits = 0;

  semesterResults.forEach((semester) => {
    if (!semester.courses || semester.courses.length === 0) {
      console.log(`No courses found for semester: ${semester._id}`);
      return; // Skip this semester if no courses
    }

    const approvedCourses = filterApprovedCourses(semester.courses);
    
    approvedCourses.forEach((course) => {
      if (!course.grade || !course.unit_load) {
        console.log("Invalid course data:", course);
        return; // Skip if data is missing
      }

      totalPoints += course.grade * course.unit_load;
      totalUnits += course.unit_load;
    });
  });

  return totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : 0;
};

module.exports = { calculateGrade, get_gpa, get_session_gpa, get_cgpa, isApprovedCourse, filterApprovedCourses };
