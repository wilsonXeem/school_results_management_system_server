const express = require("express");
const router = express.Router();

const student_controller = require("../controllers/student");

router.get("/", student_controller.get_student);
router.get(
  "/results/semester/:student_id",
  student_controller.get_results_by_semester
);
router.get(
  "/results/session/:student_id/:session",
  student_controller.get_results_by_session
);
// Search student by reg_no
router.post("/search", student_controller.searchStudent);

// Update student name
router.put("/update-name", student_controller.updateStudentName);

// Update semesterResult level
router.put(
  "/update-semester-level",
  student_controller.updateSemesterResultLevel
);

// Remove a semester for a student
router.delete("/remove-semester", student_controller.removeSemester);

// Remove a session for a student
router.delete("/remove-session", student_controller.removeSession);

// Remove a specific course from a semester
router.delete("/remove-course", student_controller.removeCourseFromSemester);

// Remove a student and all associated data
router.delete("/remove-student", student_controller.removeStudent);

router.post("/moe", student_controller.moe);

router.put("/moe/update", student_controller.updateMoe)

module.exports = router;
