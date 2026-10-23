
const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

// Verify JWT
function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication required.",
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

// POST /api/bookings
// Buyers book a commodity
router.post("/", authenticateToken, (req, res) => {
  if (req.user.role !== "buyer") {
    return res.status(403).json({
      message: "Only buyers can create bookings.",
    });
  }

  const { commodityId, quantity } = req.body;

  if (
    !Number.isSafeInteger(commodityId) ||
    commodityId <= 0 ||
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return res.status(400).json({
      message: "Provide a valid commodityId and positive quantity.",
    });
  }

  try {
    const createBooking = db.transaction(() => {
      const commodity = db.prepare(`
        SELECT id, seller_id, name, quantity
        FROM commodities
        WHERE id = ?
      `).get(commodityId);

      if (!commodity) {
        return { error: "Commodity not found.", status: 404 };
      }

      if (commodity.seller_id === Number(req.user.sub)) {
        return {
          error: "You cannot book your own commodity.",
          status: 400,
        };
      }

      // Reserve stock only if sufficient quantity remains.
      const stockUpdate = db.prepare(`
        UPDATE commodities
        SET quantity = quantity - ?
        WHERE id = ? AND quantity >= ?
      `).run(quantity, commodityId, quantity);

      if (stockUpdate.changes !== 1) {
        return {
          error: "Insufficient stock for this booking.",
          status: 409,
        };
      }

      const result = db.prepare(`
        INSERT INTO bookings
          (buyer_id, commodity_id, quantity, status)
        VALUES (?, ?, ?, 'pending')
      `).run(Number(req.user.sub), commodityId, quantity);

      return {
        booking: db.prepare(`
          SELECT
            b.id,
            b.buyer_id,
            b.commodity_id,
            b.quantity,
            b.status,
            b.created_at,
            c.name AS commodity_name
          FROM bookings b
          JOIN commodities c ON c.id = b.commodity_id
          WHERE b.id = ?
        `).get(result.lastInsertRowid),
      };
    });

    const result = createBooking();

    if (result.error) {
      return res.status(result.status).json({
        message: result.error,
      });
    }

    return res.status(201).json({
      message: "Booking created successfully.",
      booking: result.booking,
    });
  } catch (error) {
    console.error("Create booking error:", error.message);
    return res.status(500).json({
      message: "Could not create booking.",
    });
  }
});

// GET /api/bookings/my
// Buyers view their own bookings
router.get("/my", authenticateToken, (req, res) => {
  if (req.user.role !== "buyer") {
    return res.status(403).json({
      message: "This endpoint is for buyers.",
    });
  }

  try {
    const bookings = db.prepare(`
      SELECT
        b.id,
        b.commodity_id,
        b.quantity,
        b.status,
        b.created_at,
        c.name AS commodity_name,
        c.unit,
        c.price,
        u.full_name AS farmer_name
      FROM bookings b
      JOIN commodities c ON c.id = b.commodity_id
      JOIN users u ON u.id = c.seller_id
      WHERE b.buyer_id = ?
      ORDER BY b.id DESC
    `).all(Number(req.user.sub));

    return res.json({
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    console.error("Fetch buyer bookings error:", error.message);
    return res.status(500).json({
      message: "Could not retrieve bookings.",
    });
  }
});

// GET /api/bookings/farmer
// Farmers view bookings for their own commodities
router.get("/farmer", authenticateToken, (req, res) => {
  if (req.user.role !== "farmer") {
    return res.status(403).json({
      message: "This endpoint is for farmers.",
    });
  }

  try {
    const bookings = db.prepare(`
      SELECT
        b.id,
        b.quantity,
        b.status,
        b.created_at,
        c.id AS commodity_id,
        c.name AS commodity_name,
        u.full_name AS buyer_name
      FROM bookings b
      JOIN commodities c ON c.id = b.commodity_id
      JOIN users u ON u.id = b.buyer_id
      WHERE c.seller_id = ?
      ORDER BY b.id DESC
    `).all(Number(req.user.sub));

    return res.json({
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    console.error("Fetch farmer bookings error:", error.message);
    return res.status(500).json({
      message: "Could not retrieve bookings.",
    });
  }
});

// PATCH /api/bookings/:id/status
// Farmers manage bookings for their own commodities
router.patch("/:id/status", authenticateToken, (req, res) => {
  if (req.user.role !== "farmer") {
    return res.status(403).json({
      message: "Only farmers can manage booking status.",
    });
  }

  const bookingId = Number(req.params.id);
  const { status } = req.body;

  if (
    !Number.isSafeInteger(bookingId) ||
    bookingId <= 0 ||
    !["confirmed", "rejected", "completed"].includes(status)
  ) {
    return res.status(400).json({
      message: "Provide a valid booking ID and status.",
    });
  }

  try {
    const updateBooking = db.transaction(() => {
      const booking = db.prepare(`
        SELECT b.id, b.quantity, b.status, b.commodity_id,
               c.seller_id
        FROM bookings b
        JOIN commodities c ON c.id = b.commodity_id
        WHERE b.id = ?
      `).get(bookingId);

      if (!booking) {
        return { error: "Booking not found.", status: 404 };
      }

      if (booking.seller_id !== Number(req.user.sub)) {
        return {
          error: "You cannot manage another farmer's booking.",
          status: 403,
        };
      }

      const allowed =
        (booking.status === "pending" &&
          ["confirmed", "rejected"].includes(status)) ||
        (booking.status === "confirmed" && status === "completed");

      if (!allowed) {
        return {
          error: `Cannot change booking from ${booking.status} to ${status}.`,
          status: 409,
        };
      }

      if (status === "rejected") {
        db.prepare(`
          UPDATE commodities
          SET quantity = quantity + ?
          WHERE id = ?
        `).run(booking.quantity, booking.commodity_id);
      }

      db.prepare(`
        UPDATE bookings SET status = ? WHERE id = ?
      `).run(status, bookingId);

      return {
        booking: db.prepare(`
          SELECT id, buyer_id, commodity_id, quantity, status, created_at
          FROM bookings
          WHERE id = ?
        `).get(bookingId),
      };
    });

    const result = updateBooking();

    if (result.error) {
      return res.status(result.status).json({
        message: result.error,
      });
    }

    return res.json({
      message: "Booking status updated successfully.",
      booking: result.booking,
    });
  } catch (error) {
    console.error("Update booking error:", error.message);
    return res.status(500).json({
      message: "Could not update booking status.",
    });
  }
});

module.exports = router;
