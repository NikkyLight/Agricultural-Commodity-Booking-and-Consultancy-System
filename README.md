# Agricultural Commodity Booking and Consultancy System (Case Study: Faculty of Agriculture, University of Ibadan)

ACBCS is a web-based system for booking agricultural commodities and requesting agricultural consultancy. Farmers list commodities with a price, unit and stock quantity. Buyers browse the listings and book a quantity, which is reserved from stock at the time of booking. Farmers confirm, reject or complete bookings on their own listings, and buyers can cancel their own bookings. Registered users can also submit consultancy requests, which consultants pick up from a queue (assign), answer (respond) and resolve. The frontend is plain HTML, CSS and JavaScript served by the same Express server, with responsive layout for phone-sized screens. It is not yet a native mobile app or an installable PWA (see Roadmap).

## Features

- Commodity marketplace: public listing of all commodities with seller name, price, unit and remaining quantity.
- Commodity listing: farmers create new commodity listings (name, description, price, unit, quantity).
- Booking with stock reservation: a buyer books a quantity of a commodity. The stock decrement and the booking insert run in one database transaction, and the booking is refused with HTTP 409 if the remaining quantity is insufficient.
- Booking cancellation: a buyer can cancel their own booking while it is pending or confirmed. The reserved stock goes back to the listing.
- Booking status workflow: a farmer moves a booking from pending to confirmed or rejected, and from confirmed to completed. Rejecting a booking returns its quantity to stock.
- Buyer booking view: a buyer lists their own bookings with commodity, farmer name, quantity and status.
- Farmer booking view: a farmer lists all bookings made on their commodities, with buyer name and status.
- Consultancy requests: any logged-in user submits a request (subject and description). Consultants and admins see all requests in a queue with requester name and email. A consultant can assign a pending request to themselves, which stops anyone else from claiming it. Consultants and admins respond to requests, and saving a response marks the request as resolved. A requester can cancel their own request while it is pending or assigned.
- Authentication: email and password registration and login. Login returns a JWT (expires in 2 hours) that carries the user id (sub) and role. Protected routes require an `Authorization: Bearer <your token>` header.
- Role-based access: buyer, farmer and consultant roles at registration, with the access rules listed in the API section below. Admin accounts are created from the command line (see Getting started).
- Rate limiting: login and registration each allow 20 attempts per IP address every 15 minutes. After that the server returns HTTP 429 until the window passes.

Note: the cancel and assign endpoints work through the API. The frontend has no buttons for them yet (see Roadmap).

## Roles

- buyer: default role at registration. Creates bookings, views and cancels their own bookings. Can submit consultancy requests.
- farmer: lists commodities, views bookings on their commodities and updates their booking status. Can submit consultancy requests.
- consultant: views the consultancy queue, assigns requests to themselves and responds to requests. Can submit consultancy requests.
- admin: has the same consultancy queue, assign and respond access as a consultant. Public registration cannot create admins. An admin is created with `npm run create-admin` (see Getting started).

## Tech stack

- Runtime: Node.js 22 or newer, with CommonJS modules (`"type": "commonjs"`)
- Backend: Express 5 (`express` ^5.0.0)
- Database: SQLite through `better-sqlite3` (^13.0.3), a single file at `data/acbcs.db`
- Auth: `jsonwebtoken` (^9.0.0) for JWT, pinned to the HS256 algorithm, and `bcryptjs` (^3.0.0) for password hashing (12 salt rounds)
- Middleware and config: `cors` (^2.8.5), `dotenv` (^17.0.0)
- Frontend: plain HTML (`public/index.html`), CSS (`public/style.css`) and JavaScript (`public/app.js`), with no build step or framework
- Dev tooling: `nodemon` (^3.0.0) for development, ESLint 9 for linting, and Node's built-in test runner (`node --test`) for tests

## Getting started

Prerequisites: Node.js 22 or newer, and npm.

> **Important: you need Node.js 22 or newer.** The database library (`better-sqlite3`) crashes the whole app on Node 20 (it segfaults as soon as the database opens). The project's `package.json` now declares `"engines": { "node": ">=22" }`. Check your version with `node -v` before you start. If it shows v20 or lower, install Node 22 first.

1. Clone the repository and enter the folder:

   git clone https://github.com/NikkyLight/Agricultural-Commodity-Booking-and-Consultancy-System.git
   cd Agricultural-Commodity-Booking-and-Consultancy-System

2. Install dependencies:

   npm install

3. Create your `.env` file. The repository includes a template called `.env.example`. Copy it:

   cp .env.example .env

   Then open `.env` and fill in these values:

   - JWT_SECRET: a secret string of at least 32 characters. Login does not work without it. You can generate a strong one with:

     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

   - PORT: the port the server listens on. The default is 5000.
   - CORS_ORIGINS: optional. Leave it empty to allow only the frontend served by this app. If you host the frontend elsewhere, list its address here, separated by commas.
   - ADMIN_PASSWORD: optional. Only used by the admin command in the next step. If you leave it empty, the command asks you for the password.

   Never commit your real `.env` file. It is already listed in `.gitignore`.

4. Create the first admin account (optional, but needed to use the consultancy queue as an admin):

   ADMIN_PASSWORD=your-admin-password npm run create-admin -- --email you@example.com --name "Your Name"

   The admin password must be at least 8 characters and include at least one letter and one number. Running the command again with the same email updates that account to admin and resets its password. The password is never passed as a command-line argument, so it does not end up in your shell history. If you leave out ADMIN_PASSWORD, the command prompts you for it.

5. Start the server:

   npm start

   This runs `node src/server.js`. For development with auto-restart on file changes, run `npm run dev`, which runs `nodemon src/server.js`.

6. Open the app in a browser at http://localhost:5000 (or the port you set in PORT). The health check is at http://localhost:5000/api/health.

Testing and linting:

- `npm test` runs the automated tests in `test/`. The current test file checks the booking path: stock reservation, the race for the last units, cancellation, and access control. All 5 tests pass on Node 22.
- `npm run lint` checks the code in `src`, `scripts` and `test` with ESLint. It reports no errors.
- `src/test-db.js` is a helper file that prints the table names in the database. It is not an npm script, so run it with `node src/test-db.js`.

## Database

The database is SQLite. There is no separate schema file or migration tool. The schema is created at startup in `src/config/database.js`:

- The `data/` folder is created automatically if it does not exist.
- The database file `data/acbcs.db` is opened (and created if missing). To use a different file, set ACBCS_DB_PATH. The tests use this to run on a temporary database.
- Foreign keys are enabled.
- Each table is created with `CREATE TABLE IF NOT EXISTS`, so restarting the server does not delete data.
- For existing databases created before a feature was added, the code adds the missing columns with `ALTER TABLE`. This covers the consultancy columns `response`, `responded_by`, `responded_at` and `assigned_to`. Existing rows are kept.
- The console prints "ACBCS database initialized." when this finishes.

Tables:

- users: id, full_name, email (unique, stored lowercase), password_hash, role (buyer, farmer, consultant or admin; default buyer), created_at.
- commodities: id, seller_id (references users.id), name, description, price (REAL, must be 0 or more), unit, quantity (REAL, must be 0 or more), created_at.
- bookings: id, buyer_id (references users.id), commodity_id (references commodities.id), quantity (REAL, must be above 0), status (pending, confirmed, rejected, completed or cancelled; default pending), created_at.
- consultancy_requests: id, user_id (references users.id), subject, description, status (pending, assigned, resolved or cancelled; default pending), created_at, response, responded_by, responded_at, assigned_to.

Status changes made by the routes:

- Bookings: pending to confirmed or rejected, confirmed to completed (farmer), and pending or confirmed to cancelled (buyer).
- Consultancy requests: pending to assigned (consultant or admin), pending or assigned to cancelled (requester), and saving a response sets resolved.

## API endpoints

All endpoints are under the base URL http://localhost:5000. Request and response bodies are JSON. Error responses use a `message` field for commodity, booking and consultancy routes and an `error` field for auth routes.

Auth: "Public" means no token needed. "Bearer" means a valid JWT in the Authorization header.

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| GET | /api/health | Public | Checks that the API can reach the database. |
| POST | /api/auth/register | Public | Registers a user with fullName, email, password and optional role (buyer, farmer or consultant; default buyer). The password must be at least 8 characters and include at least one letter and one number. Returns HTTP 201. Limited to 20 attempts per IP every 15 minutes (HTTP 429 after that). |
| POST | /api/auth/login | Public | Logs in with email and password. Returns a JWT (2 hours), plus the user's id, fullName, email and role. Limited to 20 attempts per IP every 15 minutes (HTTP 429 after that). |
| GET | /api/commodities | Public | Lists all commodities with seller name, newest first. |
| POST | /api/commodities | Bearer, farmer | Creates a commodity with name, unit, price (above 0), quantity (above 0) and optional description. Returns HTTP 201. |
| POST | /api/bookings | Bearer, buyer | Books commodityId with a positive quantity. Reserves the stock in a transaction. Returns HTTP 201 with the booking, or 409 if stock is insufficient, 400 if the buyer owns the commodity, 404 if the commodity does not exist. |
| GET | /api/bookings/my | Bearer, buyer | Lists the buyer's own bookings. |
| GET | /api/bookings/farmer | Bearer, farmer | Lists bookings on the farmer's commodities. |
| PATCH | /api/bookings/:id/status | Bearer, farmer (owner of the commodity) | Sets status to confirmed, rejected or completed. Allowed transitions: pending to confirmed or rejected, confirmed to completed. Rejecting returns the booked quantity to stock. Other transitions return HTTP 409. |
| PATCH | /api/bookings/:id/cancel | Bearer, buyer (owner of the booking) | Cancels the buyer's own booking while it is pending or confirmed. Returns the booked quantity to stock. Cancelling again returns HTTP 409. Another buyer's booking returns HTTP 403. |
| POST | /api/consultancy | Bearer, any role | Submits a request with subject (up to 150 characters) and description (up to 5000 characters). Returns HTTP 201. |
| GET | /api/consultancy/my | Bearer, any role | Lists the logged-in user's own consultancy requests. |
| GET | /api/consultancy/queue | Bearer, consultant or admin | Lists all consultancy requests with requester name and email. |
| POST | /api/consultancy/:id/assign | Bearer, consultant or admin | Assigns a pending request to the logged-in consultant or admin and sets its status to assigned. If someone else already took it, or it is no longer pending, returns HTTP 409. |
| PATCH | /api/consultancy/:id/cancel | Bearer, any role (requester only) | Cancels the requester's own request while it is pending or assigned. Resolved requests cannot be cancelled. Another user's request returns HTTP 403. |
| POST | /api/consultancy/:id/respond | Bearer, consultant or admin | Saves a response (up to 5000 characters), sets responded_by and responded_at, and marks the request resolved. A cancelled request returns HTTP 409. |

Any unknown route returns HTTP 404 with "Route not found". Malformed JSON returns HTTP 400, and bodies over 100 KB return HTTP 413.

## Authentication flow

1. The client calls POST /api/auth/register or POST /api/auth/login.
2. On login, the server checks the email and bcrypt password hash, then signs a JWT with the payload `{ sub: <user id>, role: <role> }` using JWT_SECRET, valid for 2 hours.
3. The client sends the token on protected requests as `Authorization: Bearer <your token>`.
4. Protected routes all go through one shared check in `src/middleware/auth.js`. A missing token returns HTTP 401. An invalid or expired token also returns HTTP 401. If JWT_SECRET is missing or shorter than 32 characters, the server returns HTTP 500 with "Authentication is not configured." so you can see the problem clearly.
5. The route then checks the role from the token (for example, only buyers can create bookings and only farmers can list commodities) and returns HTTP 403 if the role does not match.

Note: the role comes from the token, which is set at login from the database. The token is not re-checked against the database during a request. Tokens cannot be revoked before they expire.

## Project structure

    .
    ├── package.json              Scripts and dependencies (Node 22 or newer)
    ├── package-lock.json
    ├── .env.example              Template for your .env file (copy it, never commit .env)
    ├── .gitignore               Ignores node_modules, .env files, data/, logs/ and coverage/
    ├── eslint.config.js          ESLint settings for npm run lint
    ├── data/                     Created at startup; holds acbcs.db (not in the repository)
    ├── public/                   Frontend served as static files
    │   ├── index.html
    │   ├── app.js
    │   ├── style.css
    │   └── images/               Commodity images (cassava, corn, eggs, garri, groundnut, onions, palm oil, plantain, turkey, chicken)
    ├── scripts/
    │   └── create-admin.js       npm run create-admin: creates or promotes an admin account
    ├── test/
    │   └── bookings.test.js      npm test: booking stock, cancel and access checks
    └── src/
        ├── server.js             Express app, middleware, route mounting, error handlers, startup on PORT
        ├── config/
        │   └── database.js       SQLite connection, table creation and column migration
        ├── lib/
        │   └── validation.js     Password rule (8+ characters, a letter and a number, at most 72 bytes)
        ├── middleware/
        │   ├── auth.js           Shared JWT check used by every protected route, and the JWT_SECRET rule
        │   └── rateLimit.js      Login and register limit (20 per 15 minutes per IP)
        ├── routes/
        │   ├── auth.js           /api/auth: register and login
        │   ├── commodities.js    /api/commodities: list and create
        │   ├── bookings.js       /api/bookings: create, buyer and farmer views, status update, cancel
        │   └── consultancy.js    /api/consultancy: submit, my requests, queue, assign, cancel, respond
        └── test-db.js            Prints the tables in the database

## Roadmap

- Mobile support: the current frontend uses a responsive layout (viewport meta tag and CSS media queries), but it is not a native app. Planned future work includes a Progressive Web App: a web app manifest, a service worker for offline loading of the static files, and an install prompt on phones.
- Native mobile client: a possible later step once the PWA is tested with users.
- Frontend buttons for booking cancellation and consultancy assignment and cancellation: the API endpoints exist, but the web interface does not have buttons for them yet.
- More automated tests: the current test file covers the booking path only. Tests for the commodity and consultancy routes are not written yet.
- Usability testing: formal usability evaluation with a sample of users.
