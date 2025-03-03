const dotenv = require("dotenv");
dotenv.config();

const Session = require("../models/session");
const Class = require("../models/class");
const error = require("../utils/error_handler");

module.exports.register_session = async (req, res, next) => {
  const { session, current } = req.body;
  const levels = ["100", "200", "300", "400", "500", "600"];

  try {
    // Check if session already exists
    const existingSession = await Session.findOne({ session });
    if (existingSession) {
      return error.errorHandler(res, "Session already registered", "session");
    }

    // If setting as current, reset previous current session
    if (current) {
      await Session.updateMany({}, { current: false });
    }

    // Create classes for each level
    const classPromises = levels.map(async (level) => {
      const newClass = new Class({ level, students: [], courses: {} });
      return newClass.save();
    });

    const classes = await Promise.all(classPromises);

    // Create new session
    const newSession = new Session({ session, current, classes });
    await newSession.save();

    res.status(201).json({
      success: true,
      message: "Session registered successfully",
      session: newSession,
    });
  } catch (err) {
    error.error(err, next);
  }
};
