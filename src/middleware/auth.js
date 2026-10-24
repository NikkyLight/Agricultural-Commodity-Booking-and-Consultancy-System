const jwt = require("jsonwebtoken");

// Pinned to HS256 so tokens cannot pick another algorithm on verify.
const JWT_ALGORITHM = "HS256";

// Returns the signing secret, or throws if it is not safe to use.
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or shorter than 32 characters.");
  }

  return secret;
}

// Verifies the Bearer token and attaches { sub, role } to req.user.
function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return res.status(401).json({ message: "Authentication required." });
  }

  let secret;

  try {
    secret = getJwtSecret();
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ message: "Authentication is not configured." });
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: [JWT_ALGORITHM] });

    if (!payload || !payload.sub || !payload.role) {
      return res.status(401).json({ message: "Invalid or expired token." });
    }

    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

module.exports = { authenticateToken, getJwtSecret, JWT_ALGORITHM };
