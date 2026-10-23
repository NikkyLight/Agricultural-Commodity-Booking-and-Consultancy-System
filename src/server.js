require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const db = require("./config/database");
const authRoutes = require("./routes/auth");
const commodityRoutes = require("./routes/commodities");
const bookingRoutes = require("./routes/bookings");
const consultancyRoutes = require("./routes/consultancy");

const PORT = Number(process.env.PORT) || 5000;
const PUBLIC_DIR = path.join(__dirname, "../public");

// Comma-separated list, e.g. CORS_ORIGINS=https://acbcs.example.com
// Unset = same-origin only (the frontend is served by this app).
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();

app.disable("x-powered-by");

// ---------- Middleware ----------

app.use(
  cors({
    origin: allowedOrigins.length ? allowedOrigins : false,
  })
);
app.use(express.json({ limit: "100kb" }));
app.use(express.static(PUBLIC_DIR));

// ---------- API routes ----------

app.get("/api/health", (req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ status: "OK", message: "ACBCS API and database are working" });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({ status: "ERROR", message: "Database connection failed" });
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/commodities", commodityRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/consultancy", consultancyRoutes);

// ---------- Errors ----------

app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON in request body." });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large." });
  }

  console.error("Unhandled error:", error);
  res.status(500).json({ message: "Something went wrong on the server." });
});

// ---------- Startup and shutdown ----------

function start() {
  const server = app.listen(PORT, () => {
    console.log(`ACBCS server running at http://localhost:${PORT}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Only listen when run directly, so tests can import `app`.
if (require.main === module) {
  start();
}

module.exports = app;