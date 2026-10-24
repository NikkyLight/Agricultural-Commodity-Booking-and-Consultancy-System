// Fixed-window, in-memory rate limiter keyed by client IP.
// Good enough for a single-process demo deployment. It resets on restart and
// is not shared across multiple server instances.
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = req.ip || "unknown";

    if (hits.size > 10_000) {
      for (const [hitKey, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(hitKey);
      }
    }

    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    return next();
  };
}

module.exports = { createRateLimiter };
