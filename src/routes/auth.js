const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/database");
const { getJwtSecret, JWT_ALGORITHM } = require("../middleware/auth");
const { createRateLimiter } = require("../middleware/rateLimit");
const { passwordProblem } = require("../lib/validation");

const router = express.Router();

const allowedRoles = ["buyer", "farmer", "consultant"];

// Brute-force protection per IP per 15 minutes. Login and register have
// separate counters so signing up does not use up login attempts.
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const loginLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 20,
  message: "Too many login attempts. Try again in 15 minutes.",
});
const registerLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 20,
  message: "Too many registration attempts. Try again in 15 minutes.",
});

// Used when the email is unknown so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync("acbcs-timing-placeholder", 12);

router.post("/register", registerLimiter, (req, res) => {
  try {
    const { fullName, email, password, role } = req.body || {};

    if (!fullName || !email || !password) {
      return res.status(400).json({
        error: "Full name, email, and password are required.",
      });
    }

    if (typeof fullName !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Invalid input types." });
    }

    const name = fullName.trim();

    if (name.length < 2 || name.length > 100) {
      return res.status(400).json({
        error: "Full name must be between 2 and 100 characters.",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const problem = passwordProblem(password);

    if (problem) {
      return res.status(400).json({ error: problem });
    }

    // Public registration cannot create administrator accounts.
    // Admins are created with scripts/create-admin.js.
    const requestedRole = role || "buyer";

    if (typeof requestedRole !== "string" || !allowedRoles.includes(requestedRole)) {
      return res.status(400).json({
        error: "Role must be buyer, farmer, or consultant.",
      });
    }

    const existingUser = db.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        error: "An account with this email already exists.",
      });
    }

    const passwordHash = bcrypt.hashSync(password, 12);

    const result = db
      .prepare(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES (?, ?, ?, ?)`
      )
      .run(name, normalizedEmail, passwordHash, requestedRole);

    return res.status(201).json({
      message: "Registration successful.",
      user: {
        id: Number(result.lastInsertRowid),
        fullName: name,
        email: normalizedEmail,
        role: requestedRole,
      },
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({ error: "Unable to register user." });
  }
});

router.post("/login", loginLimiter, (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    let secret;

    try {
      secret = getJwtSecret();
    } catch (error) {
      console.error(error.message);
      return res.status(500).json({ error: "Authentication is not configured." });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = db
      .prepare("SELECT id, full_name, email, password_hash, role FROM users WHERE email = ?")
      .get(normalizedEmail);

    const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);

    if (!user || !passwordOk) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const token = jwt.sign({ sub: String(user.id), role: user.role }, secret, {
      algorithm: JWT_ALGORITHM,
      expiresIn: "2h",
    });

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({ error: "Unable to log in." });
  }
});

module.exports = router;
