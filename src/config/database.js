const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

// Defaults to data/acbcs.db. ACBCS_DB_PATH lets tests use a throwaway file.
const dataDirectory = path.join(__dirname, "../../data");
const dbPath = process.env.ACBCS_DB_PATH || path.join(dataDirectory, "acbcs.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'buyer'
      CHECK (role IN ('buyer', 'farmer', 'consultant', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS commodities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL CHECK (price >= 0),
    unit TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (seller_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    commodity_id INTEGER NOT NULL,
    quantity REAL NOT NULL CHECK (quantity > 0),
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN (
        'pending', 'confirmed', 'rejected', 'completed', 'cancelled'
      )),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (commodity_id) REFERENCES commodities(id)
  );

  CREATE TABLE IF NOT EXISTS consultancy_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    subject TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'assigned', 'resolved', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    response TEXT,
    responded_by INTEGER,
    responded_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Add columns to existing databases without deleting records.
const existingColumns = (table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);

const migrations = [
  ["consultancy_requests", "response", "TEXT"],
  ["consultancy_requests", "responded_by", "INTEGER"],
  ["consultancy_requests", "responded_at", "TEXT"],
  ["consultancy_requests", "assigned_to", "INTEGER"],
];

for (const [table, column, type] of migrations) {
  if (!existingColumns(table).includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

console.log("ACBCS database initialized.");

module.exports = db;
