const Session = require("../models/session");
const External = require("../models/external");

const error = require("../utils/error_handler");

module.exports.get_sessions = async (req, res, next) => {
  try {
    const sessions = await Session.find().populate("classes").populate("externals")

    res.status(200).json({
      success: true,
      message: "all sessions fetched successfully",
      sessions
    });
  } catch (err) {
    error.error(err, next);
  }
};

module.exports.get_session = async (req, res) => {
  const { session } = req.params; // Session name passed as URL param

  try {
    const foundSession = await Session.findOne({ session }).populate("classes");

    if (!foundSession) {
      return res.status(404).json({ message: "Session not found" });
    }

    res.status(200).json(foundSession);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error retrieving session" });
  }
};

module.exports.remove_session = async (req, res, next) => {
  const session_id = req.params.session;

  try {
    await Session.findByIdAndDelete(session_id);

    res
      .status(200)
      .json({ success: true, message: "session removed successfully" });
  } catch (err) {
    error.error(err, next);
  }
};
