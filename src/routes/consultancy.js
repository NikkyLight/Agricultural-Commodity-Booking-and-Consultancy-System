const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

const fail = (res, code, message) => res.status(code).json({ message });
const str = (v) => (typeof v === "string" ? v.trim() : "");

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

function requireConsultant(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (!["consultant", "admin"].includes(role)) {
    return fail(res, 403, "Only consultants and admins can perform this action.");
  }
  next();
}

// Runs a handler; logs and returns a 500 with `message` on failure.
const guarded = (label, message, handler) => (req, res) => {
  try {
    return handler(req, res);
  } catch (error) {
    console.error(`${label}:`, error.message);
    return fail(res, 500, message);
  }
};

const getRequest = (id, columns) =>
  db.prepare(`SELECT ${columns} FROM consultancy_requests WHERE id = ?`).get(id);

const COLUMNS = "id, user_id, subject, description, status, created_at, response, responded_at";

// POST /api/consultancy — submit a request
router.post(
  "/",
  authenticateToken,
  guarded("Submit consultancy request error", "Could not submit consultancy request.", (req, res) => {
    const subject = str(req.body.subject);
    const description = str(req.body.description);

    if (!subject || !description) {
      return fail(res, 400, "Subject and description are required.");
    }
    if (subject.length > 150 || description.length > 5000) {
      return fail(res, 400, "Subject must be at most 150 characters and description at most 5000.");
    }

    const { lastInsertRowid } = db
      .prepare("INSERT INTO consultancy_requests (user_id, subject, description) VALUES (?, ?, ?)")
      .run(Number(req.user.sub), subject, description);

    res.status(201).json({
      message: "Consultancy request submitted successfully.",
      request: getRequest(lastInsertRowid, COLUMNS),
    });
  })
);

// GET /api/consultancy/my — the user's own requests
router.get(
  "/my",
  authenticateToken,
  guarded("Fetch personal consultancy requests error", "Could not retrieve consultancy requests.", (req, res) => {
    const requests = db
      .prepare(
        `SELECT id, subject, description, status, created_at, response, responded_at
         FROM consultancy_requests WHERE user_id = ? ORDER BY id DESC`
      )
      .all(Number(req.user.sub));

    res.json({ count: requests.length, requests });
  })
);

// GET /api/consultancy/queue — all incoming requests (consultants/admins)
router.get(
  "/queue",
  authenticateToken,
  requireConsultant,
  guarded("Fetch consultancy queue error", "Could not retrieve incoming consultancy requests.", (req, res) => {
    const requests = db
      .prepare(
        `SELECT cr.id, cr.user_id, u.full_name AS requester_name, u.email AS requester_email,
                cr.subject, cr.description, cr.status, cr.created_at,
                cr.response, cr.responded_by, cr.responded_at
         FROM consultancy_requests cr
         LEFT JOIN users u ON u.id = cr.user_id
         ORDER BY cr.id DESC`
      )
      .all();

    res.json({ count: requests.length, requests });
  })
);

// POST /api/consultancy/:id/respond — save a response and mark resolved
router.post(
  "/:id/respond",
  authenticateToken,
  requireConsultant,
  guarded("Save consultancy response error", "Could not save the consultancy response.", (req, res) => {
    const id = Number(req.params.id);
    const response = str(req.body.response);

    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 400, "Invalid consultancy request ID.");
    if (!response) return fail(res, 400, "Please enter a response before submitting.");
    if (response.length > 5000) return fail(res, 400, "The response must not exceed 5000 characters.");

    if (!getRequest(id, "id")) return fail(res, 404, "Consultancy request not found.");

    db.prepare(
      `UPDATE consultancy_requests
       SET response = ?, responded_by = ?, responded_at = CURRENT_TIMESTAMP, status = 'resolved'
       WHERE id = ?`
    ).run(response, Number(req.user.sub), id);

    res.json({
      message: "Consultancy response saved successfully.",
      request: getRequest(id, "id, user_id, subject, description, status, created_at, response, responded_by, responded_at"),
    });
  })
);

module.exports = router;