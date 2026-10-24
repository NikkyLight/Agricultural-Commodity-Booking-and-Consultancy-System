// Creates or promotes an admin account from the command line.
// Public registration can never create admins, so this is the only path.
//
// Usage:
//   npm run create-admin -- --email admin@example.com --name "Site Admin"
//   Password comes from the ADMIN_PASSWORD env var, or from the first line
//   of stdin (e.g. echo "pass1234" | npm run create-admin -- --email ...).
//   It is never passed as a command-line argument, so it stays out of shell history.
require("dotenv").config();

const bcrypt = require("bcryptjs");
const readline = require("readline");
const db = require("../src/config/database");
const { passwordProblem } = require("../src/lib/validation");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

// Reads one line from piped stdin, e.g. `echo "pass1234" | npm run create-admin -- ...`.
function readPasswordFromStdin() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin });
    let answered = false;
    rl.on("line", (line) => {
      if (!answered) {
        answered = true;
        rl.close();
        resolve(line);
      }
    });
    rl.on("close", () => resolve(answered ? undefined : ""));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email || "").trim().toLowerCase();
  const name = String(args.name || "ACBCS Admin").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    console.error("Provide a valid --email.");
    process.exit(1);
  }
  if (name.length < 2 || name.length > 100) {
    console.error("--name must be between 2 and 100 characters.");
    process.exit(1);
  }

  const password = process.env.ADMIN_PASSWORD || (await readPasswordFromStdin()) || "";
  const problem = password ? passwordProblem(password) : "Set ADMIN_PASSWORD or pipe the password on stdin.";

  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email);

  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', password_hash = ? WHERE id = ?").run(passwordHash, existing.id);
    console.log(`Updated existing account ${email} to admin and reset its password.`);
  } else {
    db.prepare("INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, 'admin')").run(
      name,
      email,
      passwordHash
    );
    console.log(`Created admin account ${email}.`);
  }

  db.close();
}

main().catch((error) => {
  console.error("Could not create admin:", error.message);
  process.exit(1);
});
