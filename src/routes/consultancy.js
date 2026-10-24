const express = require("express");
const db = require("../config/database");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

const fail = (res, code, message) => res.status(code).json({ message });
const str = (v) => (typeof v === "string" ? v.trim() : "");

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

const COLUMNS =
  "id, user_id, subject, description, status, created_at, response, responded_at, assigned_to";

// POST /api/consultancy - submit a request
router.post(
  "/",
  authenticateToken,
  guarded("Submit consultancy request error", "Could not submit consultancy request.", (req, res) => {
    const subject = str(req.body?.subject);
    const description = str(req.body?.description);

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

// GET /api/consultancy/my - the user's own requests
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

// GET /api/consultancy/queue - all incoming requests (consultants/admins)
router.get(
  "/queue",
  authenticateToken,
  requireConsultant,
  guarded("Fetch consultancy queue error", "Could not retrieve incoming consultancy requests.", (req, res) => {
    const requests = db
      .prepare(
        `SELECT cr.id, cr.user_id, u.full_name AS requester_name, u.email AS requester_email,
                cr.subject, cr.description, cr.status, cr.created_at,
                cr.response, cr.responded_by, cr.responded_at, cr.assigned_to
         FROM consultancy_requests cr
         LEFT JOIN users u ON u.id = cr.user_id
         ORDER BY cr.id DESC`
      )
      .all();

    res.json({ count: requests.length, requests });
  })
);

// POST /api/consultancy/:id/assign - a consultant claims a pending request.
// Sets status to 'assigned' and records who took it.
router.post(
  "/:id/assign",
  authenticateToken,
  requireConsultant,
  guarded("Assign consultancy request error", "Could not assign the consultancy request.", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 400, "Invalid consultancy request ID.");

    const existing = getRequest(id, "id, status, assigned_to");

    if (!existing) return fail(res, 404, "Consultancy request not found.");
    if (existing.status !== "pending") {
      return fail(res, 409, `Cannot assign a request that is ${existing.status}.`);
    }

    // Only claim while still pending, so two consultants cannot both take it.
    const update = db
      .prepare(
        `UPDATE consultancy_requests SET status = 'assigned', assigned_to = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(Number(req.user.sub), id);

    if (update.changes !== 1) return fail(res, 409, "This request was just taken by someone else.");

    res.json({
      message: "Consultancy request assigned successfully.",
      request: getRequest(id, COLUMNS),
    });
  })
);

// PATCH /api/consultancy/:id/cancel - the requester withdraws their own request.
// Allowed while pending or assigned; resolved requests cannot be cancelled.
router.patch(
  "/:id/cancel",
  authenticateToken,
  guarded("Cancel consultancy request error", "Could not cancel the consultancy request.", (req, res) => {
    const id = Number(req.params.id);

    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 400, "Invalid consultancy request ID.");

    const existing = getRequest(id, "id, user_id, status");

    if (!existing) return fail(res, 404, "Consultancy request not found.");
    if (existing.user_id !== Number(req.user.sub)) {
      return fail(res, 403, "You cannot cancel another user's request.");
    }
    if (!["pending", "assigned"].includes(existing.status)) {
      return fail(res, 409, `Cannot cancel a request that is ${existing.status}.`);
    }

    db.prepare("UPDATE consultancy_requests SET status = 'cancelled' WHERE id = ? AND status IN ('pending', 'assigned')")
      .run(id);

    res.json({
      message: "Consultancy request cancelled successfully.",
      request: getRequest(id, COLUMNS),
    });
  })
);

// POST /api/consultancy/:id/respond - save a response and mark resolved
router.post(
  "/:id/respond",
  authenticateToken,
  requireConsultant,
  guarded("Save consultancy response error", "Could not save the consultancy response.", (req, res) => {
    const id = Number(req.params.id);
    const response = str(req.body?.response);

    if (!Number.isSafeInteger(id) || id < 1) return fail(res, 400, "Invalid consultancy request ID.");
    if (!response) return fail(res, 400, "Please enter a response before submitting.");
    if (response.length > 5000) return fail(res, 400, "The response must not exceed 5000 characters.");

    const existing = getRequest(id, "id, status");

    if (!existing) return fail(res, 404, "Consultancy request not found.");
    if (existing.status === "cancelled") {
      return fail(res, 409, "This request was cancelled by the requester.");
    }

    db.prepare(
      `UPDATE consultancy_requests
       SET response = ?, responded_by = ?, responded_at = CURRENT_TIMESTAMP, status = 'resolved'
       WHERE id = ?`
    ).run(response, Number(req.user.sub), id);

    res.json({
      message: "Consultancy response saved successfully.",
      request: getRequest(id, "id, user_id, subject, description, status, created_at, response, responded_by, responded_at, assigned_to"),
    });
  })
);

module.exports = router;
