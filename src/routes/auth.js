
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

const allowedRoles = ["buyer", "farmer", "consultant"];

router.post("/register", (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        error: "Full name, email, and password are required."
      });
    }

    if (typeof fullName !== "string" ||
        typeof email !== "string" ||
        typeof password !== "string") {
      return res.status(400).json({
        error: "Invalid input types."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters."
      });
    }

    if (fullName.trim().length < 2 || fullName.trim().length > 100) {
      return res.status(400).json({
        error: "Full name must be between 2 and 100 characters."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({
        error: "Enter a valid email address."
      });
    }

    // Public registration cannot create administrator accounts.
    const requestedRole = role || "buyer";

    if (!allowedRoles.includes(requestedRole)) {
      return res.status(400).json({
        error: "Role must be buyer, farmer, or consultant."
      });
    }

    const existingUser = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        error: "An account with this email already exists."
      });
    }

    const passwordHash = bcrypt.hashSync(password, 12);

    const result = db.prepare(`
      INSERT INTO users (full_name, email, password_hash, role)
      VALUES (?, ?, ?, ?)
    `).run(
      fullName.trim(),
      normalizedEmail,
      passwordHash,
      requestedRole
    );

    return res.status(201).json({
      message: "Registration successful.",
      user: {
        id: result.lastInsertRowid,
        fullName: fullName.trim(),
        email: normalizedEmail,
        role: requestedRole
      }
    });
  } catch (error) {
    console.error("Registration error:", error.message);

    return res.status(500).json({
      error: "Unable to register user."
    });
  }
});

router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        error: "Email and password are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = db.prepare(`
      SELECT id, full_name, email, password_hash, role
      FROM users
      WHERE email = ?
    `).get(normalizedEmail);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({
        error: "Invalid email or password."
      });
    }

    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
      console.error("JWT_SECRET is missing or too short.");

      return res.status(500).json({
        error: "Authentication is not configured."
      });
    }

    const token = jwt.sign(
      {
        sub: String(user.id),
        role: user.role
      },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      error: "Unable to log in."
    });
  }
});

module.exports = router;
