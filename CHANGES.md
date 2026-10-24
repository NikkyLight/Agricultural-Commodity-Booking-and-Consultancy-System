# CHANGES: ACBCS audit and fixes

Source: https://github.com/NikkyLight/Agricultural-Commodity-Booking-and-Consultancy-System (cloned at commit b892ddb). Nothing was pushed. The original repo folder is untouched except for node_modules and a local data/ folder created by the test run, which were removed.

Status key: [done] = added or changed in this fixed/ folder. [suggested] = found, not applied, with the reason.

## Environment note (read first)

better-sqlite3 13.0.3 requires Node 22 or newer (its package.json says node >=22). On the sandbox default Node 20.20.2 it segfaults on any database open, which looked like an app crash at first. Everything below was verified on Node 22.23.4. package.json now declares "engines": {"node": ">=22"} so this is visible.

## Fixes applied

1. [done] .env.example added (fixed/.env.example).
   What: template for PORT, JWT_SECRET (min 32 chars, with a command to generate one), CORS_ORIGINS, ADMIN_PASSWORD.
   Why: the README says to set JWT_SECRET in .env, but nothing showed the name or the length rule.

2. [done] .gitignore updated (fixed/.gitignore).
   Before: data/*.db and friends only.
   After: adds data/ (whole folder), logs/, coverage/. The .env, .env.*, !.env.example and node_modules/ rules were already there and are kept.
   Why: the database folder and secrets should never be committed.

3. [done] Admin creation path: scripts/create-admin.js and npm run create-admin.
   What: creates an admin account, or upgrades an existing account to admin and resets its password. Password comes from ADMIN_PASSWORD or piped stdin, never a command-line argument, so it does not land in shell history. Re-running is safe.
   Example: ADMIN_PASSWORD=yourpass123 npm run create-admin -- --email you@example.com --name "Your Name"
   Why: the admin role existed but registration blocks it and nothing else could create one.
   Verified: no password exits 1; weak password exits 1; first run creates the account; second run updates it; admin login then returns role "admin"; public register with role admin returns 400.

4. [done] Shared JWT auth middleware: src/middleware/auth.js.
   Before: three copies of authenticateToken (bookings, commodities, consultancy), each calling jwt.verify with process.env.JWT_SECRET directly. If the secret was unset, verify would throw and return a misleading "invalid token" 401.
   After: one function. It pins the algorithm to HS256, refuses to run if JWT_SECRET is missing or under 32 characters (returns 500 "Authentication is not configured." and logs the cause), and rejects tokens without sub/role.
   Why: one place to fix auth, and no algorithm-confusion path.

5. [done] Login checks the secret before the password, uses the same secret rules, and compares against a dummy hash when the email is unknown.
   Before: a missing secret was only detected after a successful password check; unknown emails returned faster than wrong passwords (a timing hint for finding accounts).
   After: both cases take about the same time and return the same message.

6. [done] Login with no body no longer returns 500.
   Before: Express 5 leaves req.body undefined when there is no body. POST /api/auth/login with no body returned 500 "Unable to log in." (confirmed by running it).
   After: req.body || {} everywhere; no body now returns 400 "Email and password are required."
   Same fix applied to bookings, commodities, consultancy.

7. [done] Rate limiting on login and register: src/middleware/rateLimit.js, used in src/routes/auth.js.
   What: fixed window per IP, 20 requests per 15 minutes for login and 20 for register, separate counters. Returns 429 with a Retry-After header.
   Verified: 22 failed logins in a row returned 401 for the first 20, then 429 for the last 2.
   Limitation: in-memory, so it resets on restart and does not work across several server processes. Fine for a single-process demo.

8. [done] Password rules: src/lib/validation.js, used in register and create-admin.
   Before: minimum 8 characters only.
   After: minimum 8, at most 72 bytes (bcrypt silently ignores anything past 72), and must contain at least one letter and one number.
   Note: existing accounts are not affected; login still accepts whatever password they already have.

9. [done] Email length cap (254) and name checks on register; commodity name/unit/description length caps; consultancy input handled as before.

10. [done] Booking cancel endpoint: PATCH /api/bookings/:id/cancel (buyer only, own booking only).
    What: allowed while status is pending or confirmed. Sets status to 'cancelled' and returns the reserved stock in the same transaction. A second cancel returns 409 and does not return stock twice.
    Why: 'cancelled' existed in the schema and the frontend, but no route set it.
    Verified: stock goes 10 to 6 (booking of 4) back to 10 after cancel; double cancel 409; another buyer gets 403.

11. [done] Consultancy assign endpoint: POST /api/consultancy/:id/assign (consultant or admin).
    What: moves a pending request to 'assigned' and records assigned_to (new column, added with an ALTER TABLE migration, existing rows kept). The update only succeeds while status is still pending, so two consultants cannot both claim it. Buyers get 403. Assigning twice gets 409.
    Verified: buyer 403; admin assigns, status 'assigned', assigned_to set; second assign 409.

12. [done] Consultancy cancel endpoint: PATCH /api/consultancy/:id/cancel (requester only).
    What: allowed while pending or assigned. Sets 'cancelled'. Resolved requests cannot be cancelled.
    Verified: requester cancel of an assigned request returns 'cancelled'.

13. [done] Responding to a cancelled request returns 409 "This request was cancelled by the requester."
    Verified: 409. Normal respond still returns 200 and sets 'resolved'.

14. [done] Database path can be overridden with ACBCS_DB_PATH (default is still data/acbcs.db). This lets the test and the seed script run on a throwaway file. Default behavior unchanged.

15. [done] One real test file: test/bookings.test.js, wired as npm test (node --test test/*.test.js).
    It starts the bookings router on a random port against a temporary database and checks:
    a) booking reserves stock and a too-large booking returns 409 without changing stock;
    b) two buyers racing for the last 3 units: exactly one gets 201 and one gets 409, stock ends at 0;
    c) buyer cancel returns stock, sets status 'cancelled', and a second cancel does not return stock again;
    d) another buyer cannot cancel the booking (403) and stock is unchanged;
    e) missing or forged token returns 401 and stock is unchanged.
    Result: 5 of 5 pass on Node 22.

16. [done] Lint config: eslint.config.js (eslint 9 flat config), npm run lint.
    Result: clean (no errors) across src, scripts and test.

17. [done] Removed a leftover eslint-disable comment in src/server.js. No code change.

18. [done] Engines field set to node >=22 (see environment note).

19. [done] Cleanup: the duplicated authenticateToken functions were removed from the three route files (replaced by the shared module). Commodities route no longer has its own local helper.

20. [done] Error handling: the global error handler in server.js already covers invalid JSON (400) and oversized bodies (413). Route-level guarded() wrappers kept.

21. [done] Security headers: helmet 8.3.0 added (package.json, package-lock.json) and wired in src/server.js as app.use(helmet()) before cors and the routes.
   What it sends: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, Referrer-Policy: no-referrer, Cross-Origin-Opener-Policy and Cross-Origin-Resource-Policy: same-origin, and others.
   CSP choice: helmet's default policy kept, no custom directives. Scripts are limited to same-origin (script-src 'self'); public/index.html loads app.js from the same server with no inline script, and app.js has no inline event handlers (onclick and similar: 0 matches). Styles keep helmet's default 'unsafe-inline' because app.js builds tables with inline style="" attributes. The CSP was not blocking anything in the checks below.
   Why: one-line standard hardening; it does not change any API behaviour.
   Verified: npm test 5 of 5 pass; npm run lint clean; live server on Node 22 returns the headers on / and app.js still serves with 200; /api/health returns OK; login with an empty body still returns 400. Not checked in a real browser (no browser was used), so a page-level CSP violation would only show in the browser console.

## Verification run

- npm ci and npm install on Node 22: OK.
- npm test: 5 of 5 pass.
- npm run lint: 0 errors.
- Live server start (node src/server.js) on Node 22: "ACBCS server running", /api/health returns OK, /api/commodities returns 200, clean shutdown on SIGTERM.
- End-to-end run against a temp database: admin seed, admin login, register-as-admin blocked, weak passwords blocked, book 6 then oversell 5 (409), cancel (200), farmer cannot cancel (403), stock restored to 10, consultancy assign/cancel/respond all as expected. Also login rate limit 20 then 429.
- Failed earlier, now fixed: login with no body returned 500 (fixed, item 6). Some first attempts to run the server failed because of the Node 20 segfault (environment, see note).

## Found but NOT fixed (suggested, awaiting your yes)

a. [suggested] Frontend buttons for the new endpoints. The API now supports booking cancel, consultancy assign and consultancy cancel, but public/app.js has no buttons for them. Reason: changing the frontend is a bigger change than the audit scope; the endpoints work from the API. Suggest adding: a Cancel button on buyer bookings (NEXT_STATUS-style), and an Assign button in the consultancy queue. The 'cancelled' status is already displayed as a badge.

b. [suggested] Add helmet for security headers and tighter CSP. Reason: adds a new dependency; left out to avoid changing the stack.

c. [suggested] Token expiry is 2 hours with no logout or revocation. Reason: needs a token blacklist or refresh flow; a design decision.

d. [suggested] Rate limiter is in memory. Reason: a shared store (e.g. Redis) would need a new service; fine for demo.

e. [suggested] No database backup or migration framework. The migration here is a simple ALTER TABLE check.

f. [suggested] Farmers cannot cancel bookings and the farmer status buttons (Confirm/Reject/Complete) still only work for specific transitions. Left as-is; this is a policy choice.

g. [suggested] Stock is only returned on cancel or reject, not when a booking is completed. This matches the original design.

h. [suggested] public/app.js was not audited line by line for XSS beyond the esc() usage seen in the rendering code. Not changed.

i. [suggested] README.md was not touched (per instruction). Its node version and password rules may need updating to match: Node 22+, password needs a letter and a number, JWT_SECRET at least 32 characters.

j. [suggested] src/test-db.js is a manual smoke script (lists tables). Kept, not dead; it is not part of npm test.

k. [suggested] The original repo's package-lock.json was regenerated to add eslint and its helper packages. Review the diff before committing.

l. [suggested] Admin accounts created by the script have no separate admin UI beyond the existing 'admin' view, which already exists in public/app.js (role-based dashboard with consultancy queue).

## Frontend changes: cancel and assign buttons

Scope: public/app.js only. No backend, HTML or CSS changes. The new buttons use the existing button classes (btn, btn-primary, btn-outline) and the existing toast/confirm pattern, so they look like the buttons already on the Incoming bookings table.

a. [done] Buyer "My bookings" table gets an Action column with a Cancel button on pending and confirmed bookings. Cancelled and completed bookings show a dash (the server returns 409 for those anyway).
   Calls: PATCH /api/bookings/:id/cancel (no request body).
   After success: shows a green toast with the server message, then reloads the bookings list and the commodity list (so the stock count is correct again) and refreshes the overview count.
   On failure: shows a red toast with the server message (for example "Cancel a booking that is cancelled").
   Asks "Cancel this booking? Reserved stock will be returned to the farmer." first.

b. [done] Consultancy table (consultant and admin queue) gets an Action column.
   "Assign to me" button, shown only on requests with status pending.
   Calls: POST /api/consultancy/:id/assign (no request body).
   After success: green toast, reloads the queue and overview. On failure (for example, someone else took it): red toast with the server message.

c. [done] Consultancy "Cancel" button on requests the current user submitted, while the request is pending or assigned.
   Calls: PATCH /api/consultancy/:id/cancel (no request body).
   Asks "Cancel this consultancy request?" first. Shown in the buyer's list, and in the staff queue only on requests the staff member submitted themselves (the API blocks cancelling anyone else's request, so the button is hidden there).
   After success: green toast, reloads the list and overview. On failure: red toast with the server message.

d. [done] The Action column is added to both tables' headers. Rows without a button show a dash (-), the same as the farmer bookings table.

e. [done] Click handling: three new data attributes (data-cancel-booking, data-assign-request, data-cancel-request) are picked up in the existing document click listener, next to data-status. Nothing existing was removed.

f. [done] The buyer Cancel button now shows on confirmed bookings as well as pending ones. The API already allowed cancelling a confirmed booking, so bookings.js was not changed. Cancelled and completed bookings still get no button and the server still refuses them.

g. [suggested] The queue shows the Assign button only on pending requests, so an already-assigned request has no button for staff. The API would allow the assigned consultant to act on it later, but no button does that yet. Fine for the demo, not a bug.

h. [suggested] The confirm() prompts are the browser's built-in dialog, the same as the existing farmer status buttons. A custom modal would be nicer but is a bigger change.

Verification (Node 22.23.4, throwaway database, server started with fixed/.env from .env.example):
- Registered a buyer, a farmer and a consultant through POST /api/auth/register. Logged all three in.
- Farmer created a commodity (Maize, 50 kg). Buyer booked 5 kg. Buyer list showed the booking as pending.
- PATCH /api/bookings/:id/cancel returned 200 and the list showed cancelled. Stock went back to 50. Cancelling again returned 409 with a clear message.
- Buyer submitted a consultancy request. Consultant saw it in the queue and called POST /api/consultancy/:id/assign: 200. Assigning again returned 409. Buyer and farmer calling assign returned 403.
- Buyer cancelled a pending request: 200. Consultant trying to cancel another user's request: 403. Buyer cancelling an assigned request: 200.
- All button calls behave as the code expects. The browser click itself was not tested (no browser was used); the JavaScript passes node --check and the table column counts match.
- The server crashed with exit code 139 (segfault) when started as a background process in this sandbox, but ran normally when started as a child process of a Node script and in the foreground. The crash is an environment problem, not an app bug; the API calls above ran against that server.

## Files in fixed/

- .env.example (new)
- .gitignore (changed)
- eslint.config.js (new)
- package.json (changed: test, create-admin, lint scripts; engines; eslint devDeps)
- package-lock.json (regenerated)
- scripts/create-admin.js (new)
- src/config/database.js (changed: ACBCS_DB_PATH, consultancy assigned_to migration, shared table migration loop)
- src/lib/validation.js (new)
- src/middleware/auth.js (new)
- src/middleware/rateLimit.js (new)
- src/routes/auth.js (changed)
- src/routes/bookings.js (changed: cancel endpoint, shared auth)
- src/routes/commodities.js (changed: shared auth, length caps)
- src/routes/consultancy.js (changed: assign, cancel, shared auth)
- src/server.js (copied; one lint comment removed)
- src/test-db.js (copied, unchanged)
- test/bookings.test.js (new)
- public/ (copied; only change is that em/en dash characters in app.js, index.html and the route files were replaced with plain hyphens, so check any UI text that used them)
- src/routes/bookings.js, commodities.js, consultancy.js were also touched by the dash cleanup (see above)
