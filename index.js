const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const bodyParser = require("body-parser");
const cors = require("cors");
const compression = require("compression");

const auth_routes = require("./routes/auth");
const session_routes = require("./routes/session");
const class_routes = require("./routes/class");
const student_routes = require("./routes/student");

dotenv.config();
const app = express();

app.use(cors());
app.use(compression());
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

// Set headers
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, , X-Requested-With, Origin, Accept"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "OPTIONS, GET, POST, PUT, PATCH, DELETE"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.get("/", (req, res, next) => res.send("Hello world !!!"));

app.use("/api/auth", auth_routes);
app.use("/api/sessions", session_routes);
app.use("/api/class", class_routes);
app.use("/api/student", student_routes);

// connect to database
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("database connect successfully"))
  .catch((err) => console.log(err));

const server = app.listen(1234, () => console.log("server started"));

io = require("./utils/socket").init(server);
io.on("connection", () => console.log("socket connected"));
