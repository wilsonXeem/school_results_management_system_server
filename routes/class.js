const express = require("express");
const router = express.Router();

const class_controller = require("../controllers/class");

router.post("/register", class_controller.register_students);
router.post("/external", class_controller.register_external);
router.post("/score", class_controller.add_score);
router.post("/", class_controller.get_class);
router.post("/probation", class_controller.probation_list);
router.post("/error", class_controller.error_students);
router.get(
  "/:session/:semester/:course_code",
  class_controller.get_students_by_course
);

module.exports = router;
