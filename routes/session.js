const express = require("express");
const router = express.Router();

const session_controller = require("../controllers/session");

router.get("/", session_controller.get_sessions);
router.get("/:session", session_controller.get_session);
router.delete("/:session", session_controller.remove_session);

module.exports = router;
