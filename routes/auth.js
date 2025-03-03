const express = require("express");
const router = express.Router();
const multer = require("multer");
const auth_controller = require("../controllers/auth");

const upload = multer({ dest: "../uploads" });

router.post("/session", auth_controller.register_session);

module.exports = router;
