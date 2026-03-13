const express = require("express");
const router = express.Router();

const class_controller = require("../controllers/class");

router.post("/register", class_controller.register_students);
router.post("/external", class_controller.register_external);
router.post("/score", class_controller.add_score);
router.post("/", class_controller.get_class);
router.post("/probation", class_controller.probation_list);
router.post("/error", class_controller.error_students);
router.get("/finalists", class_controller.finalists);
router.post("/outstanding", class_controller.outstanding_failed_courses);
router.get(
  "/temp/600-three-course-average",
  class_controller.temp600ThreeCourseAverage
);
router.get(
  "/:session/:semester/:course_code",
  class_controller.get_students_by_course
);
router.get("/topstudents/:class_id", class_controller.getTopStudents);
router.post(
  "/topstudents/department/:class_id",
  class_controller.getTopStudentsByDepartment
);
router.get("/find-duplicates", class_controller.findDuplicates);
router.post("/merge-specific-duplicate", class_controller.mergeSpecificDuplicate);
router.post("/merge-duplicates", class_controller.mergeDuplicateStudents);
router.post("/trim-regnos", class_controller.trimAllRegNos);

module.exports = router;
