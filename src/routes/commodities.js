
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

// Authenticate requests using a JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication required. Please log in.",
    });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }
}

// GET /api/commodities
// Public: view all listed commodities
router.get("/", (req, res) => {
  try {
    const commodities = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.price,
        c.unit,
        c.quantity,
        c.created_at,
        c.seller_id,
        u.full_name AS seller_name
      FROM commodities c
      JOIN users u ON u.id = c.seller_id
      ORDER BY c.id DESC
    `).all();

    res.json({
      count: commodities.length,
      commodities,
    });
  } catch (error) {
    console.error("Fetch commodities error:", error.message);
    res.status(500).json({
      message: "Could not retrieve commodities.",
    });
  }
});

// POST /api/commodities
// Farmers can list commodities
router.post("/", authenticateToken, (req, res) => {
  if (req.user.role !== "farmer") {
    return res.status(403).json({
      message: "Only farmers can list commodities.",
    });
  }

  const {
    name,
    description = "",
    price,
    unit,
    quantity,
  } = req.body;

  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof unit !== "string" ||
    !unit.trim() ||
    !Number.isFinite(price) ||
    price <= 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return res.status(400).json({
      message:
        "Provide a name, unit, positive price, and positive quantity.",
    });
  }

  if (
    description !== undefined &&
    typeof description !== "string"
  ) {
    return res.status(400).json({
      message: "Description must be text.",
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO commodities
        (seller_id, name, description, price, unit, quantity)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      Number(req.user.sub),
      name.trim(),
      description.trim(),
      price,
      unit.trim(),
      quantity
    );

    const commodity = db.prepare(`
      SELECT
        id, seller_id, name, description,
        price, unit, quantity, created_at
      FROM commodities
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json({
      message: "Commodity listed successfully.",
      commodity,
    });
  } catch (error) {
    console.error("Create commodity error:", error.message);
    res.status(500).json({
      message: "Could not list commodity.",
    });
  }
});

module.exports = router;

