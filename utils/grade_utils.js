const SemesterResult = require("../models/semester_result");

// Function to calculate grade based on score
const calculateGrade = (score, type) => {
  if (type === "regular") {
    if (score >= 70) return 5;
    else if (score >= 60) return 4;
    else if (score >= 50) return 3;
    else return 0;
  } else if (type === "external") {
    if (score >= 70) return 5;
    else if (score >= 60) return 4;
    else if (score >= 50) return 3;
    else if (score >= 45) return 2;
    else if (score >= 40) return 1;
    else return 0;
  } else if (type === "ceutics") {
    if (score >= 70) return 5;
    else if (score >= 60) return 4;
    else return 0;
  } else {
    throw new Error("Invalid grade type provided");
  }
};

// Function to calculate GPA for a semester
const get_gpa = (semesterResult) => {
  let totalPoints = 0;
  let totalUnits = 0;

  semesterResult.courses.forEach((course) => {
    totalPoints += course.grade * course.unit_load;
    totalUnits += course.unit_load;
  });

  return totalUnits > 0 ? (totalPoints / totalUnits).toFixed(2) : 0;
};

// Function to calculate GPA for a semester
const get_session_gpa = (session) => {
  let totalPoints = 0;
  let totalUnits = 0;

  for (const semesterResult of session) {
    semesterResult?.courses.forEach((course) => {
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

    semester.courses.forEach((course) => {
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

module.exports = { calculateGrade, get_gpa, get_session_gpa, get_cgpa };
