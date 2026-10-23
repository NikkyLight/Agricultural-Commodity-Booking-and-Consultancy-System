const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

const fail = (res, code, message) => res.status(code).json({ message });
const isText = (v) => typeof v === "string" && v.trim() !== "";
const isPositive = (n) => Number.isFinite(n) && n > 0;

function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;
  if (!token) return fail(res, 401, "Authentication required. Please log in.");

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    fail(res, 401, "Invalid or expired token.");
  }
}

// GET /api/commodities — public listing
router.get("/", (req, res) => {
  try {
    const commodities = db
      .prepare(
        `SELECT c.id, c.name, c.description, c.price, c.unit, c.quantity,
                c.created_at, c.seller_id, u.full_name AS seller_name
         FROM commodities c
         JOIN users u ON u.id = c.seller_id
         ORDER BY c.id DESC`
      )
      .all();

    res.json({ count: commodities.length, commodities });
  } catch (error) {
    console.error("Fetch commodities error:", error.message);
    fail(res, 500, "Could not retrieve commodities.");
  }
});

// POST /api/commodities — farmers list a commodity
router.post("/", authenticateToken, (req, res) => {
  if (req.user.role !== "farmer") return fail(res, 403, "Only farmers can list commodities.");

  const { name, description = "", price, unit, quantity } = req.body;

  if (!isText(name) || !isText(unit) || !isPositive(price) || !isPositive(quantity)) {
    return fail(res, 400, "Provide a name, unit, positive price, and positive quantity.");
  }
  if (typeof description !== "string") return fail(res, 400, "Description must be text.");

  try {
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO commodities (seller_id, name, description, price, unit, quantity) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(Number(req.user.sub), name.trim(), description.trim(), price, unit.trim(), quantity);

    const commodity = db
      .prepare(
        `SELECT id, seller_id, name, description, price, unit, quantity, created_at
         FROM commodities WHERE id = ?`
      )
      .get(lastInsertRowid);

    res.status(201).json({ message: "Commodity listed successfully.", commodity });
  } catch (error) {
    console.error("Create commodity error:", error.message);
    fail(res, 500, "Could not list commodity.");
  }
});

module.exports = router;