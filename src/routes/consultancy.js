const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../config/database");

const router = express.Router();

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
  } catch {
    return res.status(401).json({
      message: "Invalid or expired token.",
    });
  }
}

function requireConsultant(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();

  if (!["consultant", "admin"].includes(role)) {
    return res.status(403).json({
      message: "Only consultants and admins can perform this action.",
    });
  }

  next();
}

// POST /api/consultancy
// Submit a consultancy request.
router.post("/", authenticateToken, (req, res) => {
  const { subject, description } = req.body;

  if (
    typeof subject !== "string" ||
    !subject.trim() ||
    typeof description !== "string" ||
    !description.trim()
  ) {
    return res.status(400).json({
      message: "Subject and description are required.",
    });
  }

  if (subject.trim().length > 150 || description.trim().length > 5000) {
    return res.status(400).json({
      message: "Subject must be at most 150 characters and description at most 5000.",
    });
  }

  try {
    const result = db.prepare(`
      INSERT INTO consultancy_requests (user_id, subject, description)
      VALUES (?, ?, ?)
    `).run(Number(req.user.sub), subject.trim(), description.trim());

    const request = db.prepare(`
      SELECT id, user_id, subject, description, status, created_at,
             response, responded_at
      FROM consultancy_requests
      WHERE id = ?
    `).get(result.lastInsertRowid);

    return res.status(201).json({
      message: "Consultancy request submitted successfully.",
      request,
    });
  } catch (error) {
    console.error("Submit consultancy request error:", error.message);

    return res.status(500).json({
      message: "Could not submit consultancy request.",
    });
  }
});

// GET /api/consultancy/my
// View requests submitted by the authenticated user.
router.get("/my", authenticateToken, (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT id, subject, description, status, created_at,
             response, responded_at
      FROM consultancy_requests
      WHERE user_id = ?
      ORDER BY id DESC
    `).all(Number(req.user.sub));

    return res.json({
      count: requests.length,
      requests,
    });
  } catch (error) {
    console.error("Fetch personal consultancy requests error:", error.message);

    return res.status(500).json({
      message: "Could not retrieve consultancy requests.",
    });
  }
});

// GET /api/consultancy/queue
// Consultants and admins view incoming requests.
router.get(
  "/queue",
  authenticateToken,
  requireConsultant,
  (req, res) => {
    try {
      const requests = db.prepare(`
        SELECT
          cr.id,
          cr.user_id,
          u.full_name AS requester_name,
          u.email AS requester_email,
          cr.subject,
          cr.description,
          cr.status,
          cr.created_at,
          cr.response,
          cr.responded_by,
          cr.responded_at
        FROM consultancy_requests cr
        LEFT JOIN users u ON u.id = cr.user_id
        ORDER BY cr.id DESC
      `).all();

      return res.json({
        count: requests.length,
        requests,
      });
    } catch (error) {
      console.error("Fetch consultancy queue error:", error.message);

      return res.status(500).json({
        message: "Could not retrieve incoming consultancy requests.",
      });
    }
  }
);

// POST /api/consultancy/:id/respond
// Save a consultant's response and mark the request as resolved.
router.post(
  "/:id/respond",
  authenticateToken,
  requireConsultant,
  (req, res) => {
    const id = Number(req.params.id);
    const response =
      typeof req.body.response === "string"
        ? req.body.response.trim()
        : "";

    if (!Number.isSafeInteger(id) || id < 1) {
      return res.status(400).json({
        message: "Invalid consultancy request ID.",
      });
    }

    if (!response) {
      return res.status(400).json({
        message: "Please enter a response before submitting.",
      });
    }

    if (response.length > 5000) {
      return res.status(400).json({
        message: "The response must not exceed 5000 characters.",
      });
    }

    try {
      const existing = db.prepare(`
        SELECT id
        FROM consultancy_requests
        WHERE id = ?
      `).get(id);

      if (!existing) {
        return res.status(404).json({
          message: "Consultancy request not found.",
        });
      }

      db.prepare(`
        UPDATE consultancy_requests
        SET response = ?,
            responded_by = ?,
            responded_at = CURRENT_TIMESTAMP,
            status = 'resolved'
        WHERE id = ?
      `).run(response, Number(req.user.sub), id);

      const updatedRequest = db.prepare(`
        SELECT id, user_id, subject, description, status, created_at,
               response, responded_by, responded_at
        FROM consultancy_requests
        WHERE id = ?
      `).get(id);

      return res.json({
        message: "Consultancy response saved successfully.",
        request: updatedRequest,
      });
    } catch (error) {
      console.error("Save consultancy response error:", error.message);

      return res.status(500).json({
        message: "Could not save the consultancy response.",
      });
    }
  }
);

module.exports = router;