// Seeds the marketplace with demo produce so a fresh deployment isn't empty.
// Idempotent: does nothing if commodities already exist.
// Usage: node scripts/seed-demo.js
require("dotenv").config();

const db = require("../src/config/database");
const bcrypt = require("bcryptjs");

const DEMO = [
  ["Cassava tubers", "Freshly harvested cassava tubers from Oyo farms.", 450, "per tuber", 500],
  ["Garri (white)", "Fine white garri, well processed and dried.", 1200, "per paint bucket", 200],
  ["Yellow maize", "Dried yellow maize, properly sorted.", 38000, "per bag (100kg)", 40],
  ["Plantain bunch", "Ripe and unripe plantain bunches available.", 4500, "per bunch", 120],
  ["Pineapple", "Sweet juicy pineapples from Epe farms.", 900, "each", 250],
  ["Orange", "Sweet oranges, bulk supply available.", 200, "each", 800],
  ["Avocado pear", "Fresh avocado pears.", 500, "each", 150],
  ["Tomatoes", "Fresh tomatoes, no chemicals.", 15000, "per basket", 30],
  ["Bell pepper (tatashe)", "Fresh red tatashe peppers.", 12000, "per basket", 25],
  ["Onions", "Fresh red onions from the north.", 28000, "per bag", 20],
  ["Palm oil", "Pure unadulterated red palm oil.", 9500, "per 5L keg", 60],
  ["Groundnut", "Dried groundnut, well cleaned.", 45000, "per bag (100kg)", 15],
  ["Wheat", "Dried wheat grains.", 40000, "per bag (100kg)", 10],
  ["Live chicken (broiler)", "Healthy broiler chickens, 2kg+.", 6500, "each", 100],
  ["Live turkey", "Big healthy turkeys for the season.", 18000, "each", 40],
  ["Eggs (crate)", "Fresh table eggs, straight from the farm.", 4800, "per crate", 200],
];


// Removes produce the team pulled from the marketplace (runs every boot).
const REMOVED = ["Ofada rice", "Yam tubers", "Mango", "Soybeans", "Cocoa beans", "Catfish", "Live goat"];
const del = db.prepare("DELETE FROM commodities WHERE name = ?");
for (const name of REMOVED) del.run(name);

const existing = db.prepare("SELECT COUNT(*) AS n FROM commodities").get();
if (existing.n > 0) {
  console.log(`Marketplace already has ${existing.n} commodities, skipping seed.`);
  process.exit(0);
}

const seedUser = () => {
  const email = "demo.farmer@acbcs.com";
  const found = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (found) return found.id;
  const hash = bcrypt.hashSync("Demo-Farm-2026", 10);
  const info = db
    .prepare("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)")
    .run("Demo Farmer", email, hash, "farmer");
  return info.lastInsertRowid;
};

const sellerId = seedUser();
const insert = db.prepare(
  "INSERT INTO commodities (seller_id, name, description, price, unit, quantity) VALUES (?, ?, ?, ?, ?, ?)"
);
const tx = db.transaction(() => {
  for (const [name, description, price, unit, quantity] of DEMO) {
    insert.run(sellerId, name, description, price, unit, quantity);
  }
});
tx();
console.log(`Seeded ${DEMO.length} commodities.`);
