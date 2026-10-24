const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

// Use a throwaway database so the real data/acbcs.db is never touched.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acbcs-test-"));
process.env.ACBCS_DB_PATH = path.join(tmpDir, "test.db");
process.env.JWT_SECRET = "test-secret-that-is-long-enough-1234567890";

const db = require("../src/config/database");
const jwt = require("jsonwebtoken");

const bookingsRouter = require("../src/routes/bookings");
const express = require("express");
const app = express();
app.use(express.json());
app.use("/api/bookings", bookingsRouter);

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}/api/bookings`;
      resolve();
    });
  });
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const insertUser = (name, email, role) =>
  Number(
    db
      .prepare("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, 'x', ?)")
      .run(name, email, role).lastInsertRowid
  );

const insertCommodity = (sellerId, quantity) =>
  Number(
    db
      .prepare("INSERT INTO commodities (seller_id, name, price, unit, quantity) VALUES (?, 'Maize', 100, 'kg', ?)")
      .run(sellerId, quantity).lastInsertRowid
  );

const tokenFor = (id, role) => jwt.sign({ sub: String(id), role }, process.env.JWT_SECRET, { expiresIn: "1h" });

const stockOf = (id) => db.prepare("SELECT quantity FROM commodities WHERE id = ?").get(id).quantity;

const farmerId = insertUser("Farm Owner", "farm@test.dev", "farmer");
const buyerA = insertUser("Buyer A", "a@test.dev", "buyer");
const buyerB = insertUser("Buyer B", "b@test.dev", "buyer");

async function call(method, url, token, body) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json() };
}

test("booking reserves stock and rejects overbooking (409)", async () => {
  const commodity = insertCommodity(farmerId, 10);
  const buyer = tokenFor(buyerA, "buyer");

  const ok = await call("POST", "/", buyer, { commodityId: commodity, quantity: 6 });
  assert.equal(ok.status, 201);
  assert.equal(ok.json.booking.status, "pending");
  assert.equal(stockOf(commodity), 4);

  const tooMuch = await call("POST", "/", buyer, { commodityId: commodity, quantity: 5 });
  assert.equal(tooMuch.status, 409);
  assert.equal(stockOf(commodity), 4, "failed booking must not change stock");
});

test("two buyers cannot both take the last units", async () => {
  const commodity = insertCommodity(farmerId, 3);

  const [a, b] = await Promise.all([
    call("POST", "/", tokenFor(buyerA, "buyer"), { commodityId: commodity, quantity: 3 }),
    call("POST", "/", tokenFor(buyerB, "buyer"), { commodityId: commodity, quantity: 3 }),
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(stockOf(commodity), 0);
});

test("buyer cancel returns reserved stock and sets status cancelled", async () => {
  const commodity = insertCommodity(farmerId, 10);
  const buyer = tokenFor(buyerA, "buyer");

  const created = await call("POST", "/", buyer, { commodityId: commodity, quantity: 4 });
  assert.equal(stockOf(commodity), 6);

  const cancelled = await call("PATCH", `/${created.json.booking.id}/cancel`, buyer);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.json.booking.status, "cancelled");
  assert.equal(stockOf(commodity), 10, "cancel must return the reserved stock");

  const again = await call("PATCH", `/${created.json.booking.id}/cancel`, buyer);
  assert.equal(again.status, 409, "a cancelled booking cannot be cancelled twice");
  assert.equal(stockOf(commodity), 10, "double cancel must not return stock twice");
});

test("buyer cannot cancel another buyer's booking", async () => {
  const commodity = insertCommodity(farmerId, 5);
  const created = await call("POST", "/", tokenFor(buyerA, "buyer"), { commodityId: commodity, quantity: 2 });

  const intruder = await call("PATCH", `/${created.json.booking.id}/cancel`, tokenFor(buyerB, "buyer"));
  assert.equal(intruder.status, 403);
  assert.equal(stockOf(commodity), 3);
});

test("requests without a valid token are rejected", async () => {
  const commodity = insertCommodity(farmerId, 5);
  const none = await call("POST", "/", null, { commodityId: commodity, quantity: 1 });
  assert.equal(none.status, 401);

  const forged = jwt.sign({ sub: String(buyerA), role: "buyer" }, "wrong-secret-wrong-secret-wrong-1234");
  const bad = await call("POST", "/", forged, { commodityId: commodity, quantity: 1 });
  assert.equal(bad.status, 401);
  assert.equal(stockOf(commodity), 5);
});
