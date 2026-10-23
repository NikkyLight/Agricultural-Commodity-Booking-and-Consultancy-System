const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

const fail = (res, code, message) => res.status(code).json({ message });

function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.split(" ")[1] : null;
  if (!token) return fail(res, 401, "Authentication required.");

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    fail(res, 401, "Invalid or expired token.");
  }
}

const requireRole = (role, message) => (req, res, next) =>
  req.user.role === role ? next() : fail(res, 403, message);

// Runs a handler; logs and returns a 500 on unexpected errors.
const guarded = (label, message, handler) => (req, res) => {
  try {
    return handler(req, res);
  } catch (error) {
    console.error(`${label}:`, error.message);
    return fail(res, 500, message);
  }
};

// Wraps a transaction that returns { error, status } or a payload.
const respond = (res, result, okStatus, message, key) =>
  result.error
    ? fail(res, result.status, result.error)
    : res.status(okStatus).json({ message, [key]: result[key] });

const isId = (n) => Number.isSafeInteger(n) && n > 0;

// POST /api/bookings — buyers book a commodity
router.post(
  "/",
  authenticateToken,
  requireRole("buyer", "Only buyers can create bookings."),
  guarded("Create booking error", "Could not create booking.", (req, res) => {
    const { commodityId, quantity } = req.body;

    if (!isId(commodityId) || !Number.isFinite(quantity) || quantity <= 0) {
      return fail(res, 400, "Provide a valid commodityId and positive quantity.");
    }

    const buyerId = Number(req.user.sub);

    const result = db.transaction(() => {
      const commodity = db
        .prepare("SELECT id, seller_id FROM commodities WHERE id = ?")
        .get(commodityId);

      if (!commodity) return { error: "Commodity not found.", status: 404 };
      if (commodity.seller_id === buyerId) {
        return { error: "You cannot book your own commodity.", status: 400 };
      }

      // Reserve stock only if enough remains.
      const stock = db
        .prepare("UPDATE commodities SET quantity = quantity - ? WHERE id = ? AND quantity >= ?")
        .run(quantity, commodityId, quantity);

      if (stock.changes !== 1) {
        return { error: "Insufficient stock for this booking.", status: 409 };
      }

      const { lastInsertRowid } = db
        .prepare("INSERT INTO bookings (buyer_id, commodity_id, quantity, status) VALUES (?, ?, ?, 'pending')")
        .run(buyerId, commodityId, quantity);

      return {
        booking: db
          .prepare(
            `SELECT b.id, b.buyer_id, b.commodity_id, b.quantity, b.status, b.created_at,
                    c.name AS commodity_name
             FROM bookings b JOIN commodities c ON c.id = b.commodity_id
             WHERE b.id = ?`
          )
          .get(lastInsertRowid),
      };
    })();

    respond(res, result, 201, "Booking created successfully.", "booking");
  })
);

// GET /api/bookings/my — buyer's own bookings
router.get(
  "/my",
  authenticateToken,
  requireRole("buyer", "This endpoint is for buyers."),
  guarded("Fetch buyer bookings error", "Could not retrieve bookings.", (req, res) => {
    const bookings = db
      .prepare(
        `SELECT b.id, b.commodity_id, b.quantity, b.status, b.created_at,
                c.name AS commodity_name, c.unit, c.price, u.full_name AS farmer_name
         FROM bookings b
         JOIN commodities c ON c.id = b.commodity_id
         JOIN users u ON u.id = c.seller_id
         WHERE b.buyer_id = ?
         ORDER BY b.id DESC`
      )
      .all(Number(req.user.sub));

    res.json({ count: bookings.length, bookings });
  })
);

// GET /api/bookings/farmer — bookings on the farmer's commodities
router.get(
  "/farmer",
  authenticateToken,
  requireRole("farmer", "This endpoint is for farmers."),
  guarded("Fetch farmer bookings error", "Could not retrieve bookings.", (req, res) => {
    const bookings = db
      .prepare(
        `SELECT b.id, b.quantity, b.status, b.created_at,
                c.id AS commodity_id, c.name AS commodity_name, u.full_name AS buyer_name
         FROM bookings b
         JOIN commodities c ON c.id = b.commodity_id
         JOIN users u ON u.id = b.buyer_id
         WHERE c.seller_id = ?
         ORDER BY b.id DESC`
      )
      .all(Number(req.user.sub));

    res.json({ count: bookings.length, bookings });
  })
);

const TRANSITIONS = {
  pending: ["confirmed", "rejected"],
  confirmed: ["completed"],
};

// PATCH /api/bookings/:id/status — farmers manage their bookings
router.patch(
  "/:id/status",
  authenticateToken,
  requireRole("farmer", "Only farmers can manage booking status."),
  guarded("Update booking error", "Could not update booking status.", (req, res) => {
    const bookingId = Number(req.params.id);
    const { status } = req.body;

    if (!isId(bookingId) || !["confirmed", "rejected", "completed"].includes(status)) {
      return fail(res, 400, "Provide a valid booking ID and status.");
    }

    const result = db.transaction(() => {
      const booking = db
        .prepare(
          `SELECT b.id, b.quantity, b.status, b.commodity_id, c.seller_id
           FROM bookings b JOIN commodities c ON c.id = b.commodity_id
           WHERE b.id = ?`
        )
        .get(bookingId);

      if (!booking) return { error: "Booking not found.", status: 404 };
      if (booking.seller_id !== Number(req.user.sub)) {
        return { error: "You cannot manage another farmer's booking.", status: 403 };
      }
      if (!TRANSITIONS[booking.status]?.includes(status)) {
        return { error: `Cannot change booking from ${booking.status} to ${status}.`, status: 409 };
      }

      // Rejected bookings return their stock.
      if (status === "rejected") {
        db.prepare("UPDATE commodities SET quantity = quantity + ? WHERE id = ?")
          .run(booking.quantity, booking.commodity_id);
      }

      db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, bookingId);

      return {
        booking: db
          .prepare("SELECT id, buyer_id, commodity_id, quantity, status, created_at FROM bookings WHERE id = ?")
          .get(bookingId),
      };
    })();

    respond(res, result, 200, "Booking status updated successfully.", "booking");
  })
);

module.exports = router;