/* =========================================================
   ACBCS — Agricultural Commodity Booking & Consultancy
   Complete frontend JavaScript replacement
   Includes consultant replies and buyer response history
   ========================================================= */

"use strict";

const API = "/api";
const SESSION_KEY = "acbcs.session";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = { user: null, token: "", commodities: [], selected: null };

let expiryTimer;
let lastFocus;

/* ---------- Helpers ---------- */

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 2,
});

const money = (value) => naira.format(Number(value) || 0);

const date = (value) => {
  const parsed = new Date(String(value ?? "").replace(" ", "T"));

  return Number.isNaN(parsed.getTime())
    ? "—"
    : parsed.toLocaleDateString("en-NG", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

const pretty = (value) =>
  String(value || "")
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const badge = (status) =>
  `<span class="status-badge ${esc(status)}">${esc(pretty(status))}</span>`;

function toast(message, type = "") {
  const item = Object.assign(document.createElement("div"), {
    className: `toast ${type}`,
    textContent: message,
  });

  $("#toastRegion")?.append(item);
  setTimeout(() => item.remove(), 4000);
}

function feedback(selector, message, type = "") {
  const el = $(selector);
  if (!el) return;

  el.textContent = message;
  el.className = `form-feedback ${type}`.trim();
}

/* ---------- API ---------- */

class SessionError extends Error {}

const report = (error) =>
  error instanceof SessionError || toast(error.message, "error");

async function request(path, options = {}) {
  const headers = { ...options.headers };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let response;

  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new Error(
      "Cannot reach the server. Check that ACBCS is running."
    );
  }

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 && state.token) {
    logout("Your session has expired. Please log in again.", "error");
    throw new SessionError("Session expired.");
  }

  if (!response.ok) {
    throw new Error(
      data.error || data.message || `Request failed (${response.status}).`
    );
  }

  return data;
}

/* ---------- Session ---------- */

function tokenExpiry(token) {
  try {
    const payload = token
      .split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const { exp } = JSON.parse(atob(payload));

    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);

  const expiresAt = tokenExpiry(state.token);
  if (!expiresAt) return;

  const wait = expiresAt - Date.now();

  if (wait <= 0) {
    logout("Your session has expired. Please log in again.", "error");
  } else {
    expiryTimer = setTimeout(
      scheduleExpiry,
      Math.min(wait, 2 ** 31 - 1)
    );
  }
}

function loadSession() {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("authToken");

  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    const expiresAt = session?.token && tokenExpiry(session.token);

    if (
      session?.user &&
      session?.token &&
      !(expiresAt && expiresAt <= Date.now())
    ) {
      Object.assign(state, session);
      scheduleExpiry();
      return;
    }
  } catch {
    // Remove invalid saved sessions.
  }

  localStorage.removeItem(SESSION_KEY);
}

function setSession(user, token) {
  Object.assign(state, { user, token });

  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ user, token })
  );

  scheduleExpiry();
}

function logout(
  message = "You have been logged out.",
  type = "success"
) {
  clearTimeout(expiryTimer);

  Object.assign(state, {
    user: null,
    token: "",
    selected: null,
  });

  localStorage.removeItem(SESSION_KEY);

  $$("form").forEach((form) => form.reset());

  $("#dashboard")?.classList.add("hidden");

  closeAuth();
  closeMenu();
  renderHeader();
  renderCommodities();

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

  if (message) toast(message, type);
}

/* ---------- Header and menu ---------- */

function renderHeader() {
  const { user } = state;
  const header = $("#headerActions");

  if (!header) return;

  header.innerHTML = user
    ? `
      <span class="header-user">${esc(user.fullName)}</span>
      <button class="btn btn-primary" type="button"
        data-action="dashboard">My workspace</button>
      <button class="btn btn-outline" type="button"
        data-action="logout">Log out</button>
    `
    : `
      <button class="btn btn-outline" type="button"
        data-open-auth="login">Log in</button>
      <button class="btn btn-primary" type="button"
        data-open-auth="register">
        Get started <span aria-hidden="true">↗</span>
      </button>
    `;
}

function closeMenu() {
  $("#mainNav")?.classList.remove("open");
  $("#menuToggle")?.setAttribute("aria-expanded", "false");
}

/* ---------- Authentication modal ---------- */

const AUTH_COPY = {
  login: [
    "WELCOME BACK",
    "Welcome back.",
    "Sign in to continue to your account.",
  ],
  register: [
    "JOIN THE ACBCS COMMUNITY",
    "Create your account.",
    "Choose your role and get started.",
  ],
};

function switchAuth(mode = "login") {
  for (const m of ["login", "register"]) {
    $(`#${m}Form`)?.classList.toggle("hidden", m !== mode);

    const tab = $(`#show${pretty(m)}Tab`);

    tab?.classList.toggle("active", m === mode);
    tab?.setAttribute("aria-selected", String(m === mode));
  }

  const [eyebrow, title, subtitle] = AUTH_COPY[mode];

  if ($("#authEyebrow")) $("#authEyebrow").textContent = eyebrow;
  if ($("#authTitle")) $("#authTitle").textContent = title;
  if ($("#authSubtitle")) $("#authSubtitle").textContent = subtitle;

  feedback("#loginStatus", "");
  feedback("#registerStatus", "");
}

function openAuth(mode = "login") {
  lastFocus = document.activeElement;

  $("#authModal")?.classList.remove("hidden");
  document.body.classList.add("modal-open");

  switchAuth(mode);
  $(`#${mode}Form input`)?.focus();
}

function closeAuth() {
  const modal = $("#authModal");

  if (!modal || modal.classList.contains("hidden")) return;

  modal.classList.add("hidden");
  document.body.classList.remove("modal-open");

  lastFocus?.focus?.();
}

/* ---------- Commodity catalogue ---------- */

const PRODUCE = [
  { words: ["maize", "corn"], icon: "🌽", image: "corn.jpg" },
  { words: ["rice"], icon: "🌾", image: "rice.jpg" },
  { words: ["cassava"], icon: "🥔", image: "cassava.jpg" },
  { words: ["garri"], icon: "🥔", image: "Garri.jpg" },
  { words: ["yam"], icon: "🥔", image: "yam.jpg" },
  { words: ["soybean", "soya"], icon: "🌱", image: "soybean.jpg" },
  { words: ["beans", "bean"], icon: "🫘", image: "beans.jpg" },
  { words: ["cocoa"], icon: "🍫", image: "cocoa.jpg" },
  { words: ["tomato"], icon: "🍅", image: "tomatoes.jpg" },
  { words: ["pepper"], icon: "🌶️", image: "pepper.jpg" },
  { words: ["palm"], icon: "🌴", image: "palm oil.jpg" },
  { words: ["groundnut", "peanut"], icon: "🥜", image: "groundnut.jpg" },
  { words: ["wheat"], icon: "🌾", image: "wheat.jpg" },
  { words: ["poultry", "chicken"], icon: "🐔", image: "chicken.jpg" },
  { words: ["turkey"], icon: "🦃", image: "turkey.jpg" },
  { words: ["egg"], icon: "🥚", image: "eggs.jpg" },
  { words: ["onion"], icon: "🧅", image: "onions.jpg" },
  { words: ["plantain"], icon: "🍌", image: "plantain.jpg" },
  { words: ["fish"], icon: "🐟", image: "fish.jpg" },
];

const placeholder = (icon, label) =>
  `<div class="commodity-placeholder" role="img"
    aria-label="${esc(label)}">${icon}</div>`;

function commodityVisual(item) {
  const name = String(item.name || "").toLowerCase();

  const match = PRODUCE.find((p) =>
    p.words.some((word) => name.includes(word))
  );

  if (!match) return placeholder("🌿", item.name);

  return `
    <img class="commodity-photo"
      src="/images/${encodeURIComponent(match.image)}"
      alt="${esc(item.name)}"
      data-icon="${match.icon}"
      loading="lazy">
  `;
}

/* ---------- Marketplace ---------- */

const SORTERS = {
  "price-low": (a, b) => Number(a.price) - Number(b.price),
  "price-high": (a, b) => Number(b.price) - Number(a.price),
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
  newest: (a, b) => Number(b.id) - Number(a.id),
};

function commodityCard(item) {
  const stock = Number(item.quantity) || 0;

  const own =
    state.user?.role === "farmer" &&
    Number(state.user.id) === Number(item.seller_id);

  const label = own
    ? "Your listing"
    : stock <= 0
      ? "Unavailable"
      : "Book now ↗";

  return `
    <article class="commodity-card">
      <div class="commodity-image">
        ${commodityVisual(item)}
        <span class="stock-badge">
          ${
            stock > 0
              ? `${esc(stock)} ${esc(item.unit)} available`
              : "Out of stock"
          }
        </span>
      </div>

      <div class="commodity-content">
        <h3>${esc(item.name)}</h3>

        <p class="commodity-description">
          ${esc(
            item.description ||
              "Agricultural commodity listed on ACBCS."
          )}
        </p>

        <div class="commodity-meta">
          <div>
            <div class="commodity-price">
              ${money(item.price)}
              <small>/ ${esc(item.unit)}</small>
            </div>

            <div class="commodity-seller">
              Farmer:
              <strong>${esc(item.seller_name || "ACBCS farmer")}</strong>
            </div>
          </div>

          <button class="book-button" type="button"
            data-book="${Number(item.id)}"
            ${stock <= 0 || own ? "disabled" : ""}>
            ${label}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderCommodities() {
  const grid = $("#commodityGrid");
  if (!grid) return;

  const query = ($("#commoditySearch")?.value || "")
    .trim()
    .toLowerCase();

  const sorter =
    SORTERS[$("#commoditySort")?.value] || SORTERS.newest;

  const items = state.commodities
    .filter((commodity) =>
      [
        commodity.name,
        commodity.description,
        commodity.seller_name,
        commodity.unit,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query)
    )
    .sort(sorter);

  $("#commodityEmpty")?.classList.toggle(
    "hidden",
    items.length > 0
  );

  grid.innerHTML = items.map(commodityCard).join("");
}

async function loadCommodities() {
  const grid = $("#commodityGrid");
  const status = $("#marketStatus");

  if (!grid) return;

  if (!state.commodities.length) {
    grid.innerHTML =
      '<div class="loading-state">Loading agricultural commodities...</div>';
  }

  if (status) status.textContent = "";

  try {
    const data = await request("/commodities");

    state.commodities = Array.isArray(data.commodities)
      ? data.commodities
      : [];

    renderCommodities();

    if (status) {
      status.textContent =
        `${state.commodities.length} commodity listing(s) available.`;
    }

    if (state.user?.role === "farmer") {
      renderInventory();
    }
  } catch (error) {
    grid.innerHTML = `
      <div class="loading-state">
        ${esc(error.message)}
        <p>Check your connection and refresh the listings.</p>
      </div>
    `;

    if (status) {
      status.textContent = "Unable to load commodity listings.";
    }
  }
}

/* ---------- Roles and dashboard ---------- */

const ROLES = {
  buyer: {
    welcome: "Discover produce, create bookings and follow their progress.",
    stat: ["/bookings/my", "My bookings", "bookings"],
    requests: "/consultancy/my",
  },

  farmer: {
    welcome: "Manage your listings, available stock and incoming bookings.",
    stat: ["/bookings/farmer", "Incoming bookings", "bookings"],
  },

  consultant: {
    welcome: "Review incoming agricultural consultancy requests.",
    stat: [
      "/consultancy/queue",
      "Incoming consultancy requests",
      "requests",
    ],
    requests: "/consultancy/queue",
    staff: true,
  },
};

ROLES.admin = {
  ...ROLES.consultant,
  welcome: "Manage ACBCS activities and review consultancy requests.",
};

const roleConfig = () =>
  ROLES[String(state.user?.role || "").toLowerCase()] || {};

const TAB_LOADERS = {
  overview: () => renderOverview(),
  bookings: () => loadBuyerBookings(),
  inventory: () => renderInventory(),
  farmerBookings: () => loadFarmerBookings(),
  consultancy: () => loadConsultancyHistory(),
};

function switchTab(tab) {
  $$(".dashboard-tab").forEach((button) => {
    const active = button.dataset.tab === tab;

    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });

  $$(".dashboard-panel").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `panel-${tab}`);
  });

  TAB_LOADERS[tab]?.();
}

function showDashboard({ tab = "overview", scroll = true } = {}) {
  if (!state.user) return openAuth("login");

  const { role, fullName } = state.user;
  const config = roleConfig();
  const staff = Boolean(config.staff);

  $("#dashboard")?.classList.remove("hidden");

  if ($("#dashboardName")) {
    $("#dashboardName").textContent = fullName;
  }

  if ($("#dashboardRole")) {
    $("#dashboardRole").textContent = pretty(role).toUpperCase();
  }

  if ($("#dashboardWelcomeText")) {
    $("#dashboardWelcomeText").textContent =
      config.welcome || "Manage your ACBCS activities.";
  }

  if ($("#dashboardPrimaryBtn")) {
    $("#dashboardPrimaryBtn").innerHTML =
      `${role === "farmer" ? "Manage commodities" : "Explore marketplace"}
       <span aria-hidden="true">↗</span>`;
  }

  $$("#dashboardTabs [data-roles]").forEach((button) => {
    button.hidden = !button.dataset.roles.split(" ").includes(role);
  });

  // Buyers submit questions; consultants and admins respond to them.
  const consultancyForm = $("#consultancyForm");

  if (consultancyForm) {
    consultancyForm.classList.toggle("hidden", staff);
    consultancyForm.hidden = staff;
  }

  const consultancyDescription = $(
    "#panel-consultancy .panel-heading p"
  );

  if (consultancyDescription) {
    consultancyDescription.textContent = staff
      ? "Review incoming questions and send agricultural advice."
      : "Submit a request and review your consultant's responses.";
  }

  const historyTitle = $(".history-heading h3");

  if (historyTitle) {
    historyTitle.textContent = staff
      ? "Incoming consultancy requests"
      : "My consultancy requests";
  }

  switchTab(tab);

  if (scroll) {
    $("#dashboard")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }
}

async function renderOverview() {
  const container = $("#dashboardCards");
  const user = state.user;

  if (!container || !user) return;

  const [path, label, key] = roleConfig().stat || [];
  let count = state.commodities.length;

  if (path) {
    try {
      const data = await request(path);
      count = Number(data.count ?? data[key]?.length) || 0;
    } catch (error) {
      report(error);
      count = "—";
    }
  }

  if (!state.user) return;

  container.innerHTML = `
    <div class="dashboard-stat">
      <span>Account type</span>
      <strong>${esc(pretty(user.role))}</strong>
    </div>

    <div class="dashboard-stat">
      <span>Account email</span>
      <strong class="stat-small">${esc(user.email)}</strong>
    </div>

    <div class="dashboard-stat">
      <span>${esc(label || "Marketplace listings")}</span>
      <strong>${esc(count)}</strong>
    </div>
  `;
}

/* ---------- Tables ---------- */

function table(headers, rows) {
  if (!rows.length) {
    return '<div class="table-empty">Nothing to display yet.</div>';
  }

  return `
    <table class="data-table">
      <thead>
        <tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}

async function loadTable({
  target,
  path,
  key,
  headers,
  row,
  loading,
}) {
  const el = $(target);
  if (!el) return;

  el.innerHTML = `<div class="table-empty">${esc(loading)}</div>`;

  try {
    const data = await request(path);

    if (!state.user) return;

    const records = Array.isArray(data[key]) ? data[key] : [];

    el.innerHTML = table(headers, records.map(row));
  } catch (error) {
    el.innerHTML = `
      <div class="table-empty">${esc(error.message)}</div>
    `;
  }
}

/* ---------- Buyer bookings ---------- */

const loadBuyerBookings = () =>
  loadTable({
    target: "#buyerBookings",
    path: "/bookings/my",
    key: "bookings",
    loading: "Loading bookings...",

    headers: [
      "Commodity",
      "Farmer",
      "Quantity",
      "Unit price",
      "Status",
      "Date",
    ],

    row: (b) => `
      <tr>
        <td><strong>${esc(b.commodity_name)}</strong></td>
        <td>${esc(b.farmer_name)}</td>
        <td>${esc(b.quantity)} ${esc(b.unit)}</td>
        <td>${money(b.price)}</td>
        <td>${badge(b.status)}</td>
        <td>${date(b.created_at)}</td>
      </tr>
    `,
  });

/* ---------- Farmer bookings ---------- */

const NEXT_STATUS = {
  pending: [
    ["confirmed", "Confirm", "btn-primary"],
    ["rejected", "Reject", "btn-outline"],
  ],

  confirmed: [
    ["completed", "Complete", "btn-primary"],
  ],
};

const loadFarmerBookings = () =>
  loadTable({
    target: "#farmerBookings",
    path: "/bookings/farmer",
    key: "bookings",
    loading: "Loading incoming bookings...",

    headers: [
      "Commodity",
      "Buyer",
      "Quantity",
      "Status",
      "Date",
      "Action",
    ],

    row: (b) => `
      <tr>
        <td>${esc(b.commodity_name)}</td>
        <td>${esc(b.buyer_name)}</td>
        <td>${esc(b.quantity)}</td>
        <td>${badge(b.status)}</td>
        <td>${date(b.created_at)}</td>

        <td>
          ${
            (NEXT_STATUS[b.status] || [])
              .map(
                ([value, text, cls]) => `
                  <button class="btn ${cls}" type="button"
                    data-status="${Number(b.id)}"
                    data-value="${value}">
                    ${text}
                  </button>
                `
              )
              .join("") || "—"
          }
        </td>
      </tr>
    `,
  });

/* =========================================================
   CONSULTANCY REQUESTS
   Buyers: view their requests and saved replies.
   Consultants/admins: review requests and respond.
   ========================================================= */

async function loadConsultancyHistory() {
  const container = $("#consultancyHistory");
  if (!container) return;

  const role = String(state.user?.role || "").toLowerCase();
  const isConsultant = ["consultant", "admin"].includes(role);

  const endpoint = isConsultant
    ? "/consultancy/queue"
    : "/consultancy/my";

  container.innerHTML = `
    <div class="table-empty">
      Loading ${isConsultant ? "incoming consultancy requests" : "your consultancy requests"}...
    </div>
  `;

  try {
    const data = await request(endpoint);

    const requests = Array.isArray(data.requests)
      ? data.requests
      : [];

    if (!state.user) return;

    const headers = isConsultant
      ? [
          "Requester",
          "Subject",
          "Question",
          "Consultant response",
          "Status",
          "Date",
        ]
      : [
          "Subject",
          "Question",
          "Consultant response",
          "Status",
          "Date",
        ];

    const rows = requests.map((item) => {
      const hasResponse =
        typeof item.response === "string" &&
        item.response.trim().length > 0;

      const requester = item.requester_name
        ? `
          <strong>${esc(item.requester_name)}</strong>
          ${
            item.requester_email
              ? `<br><small>${esc(item.requester_email)}</small>`
              : ""
          }
        `
        : `User #${esc(item.user_id)}`;

      const responseContent = hasResponse
        ? `
          <div style="white-space:pre-wrap">${esc(item.response)}</div>
        `
        : `
          <span>
            ${isConsultant ? "Not answered yet" : "Awaiting consultant response"}
          </span>
        `;

      const replyForm = isConsultant
        ? `
          <form
            class="consultancy-reply-form"
            data-request-id="${Number(item.id)}"
          >
            <textarea
              name="response"
              rows="4"
              maxlength="5000"
              required
              aria-label="Consultant response to ${esc(item.subject)}"
              placeholder="Write your agricultural advice..."
            >${esc(item.response || "")}</textarea>

            <div class="reply-form-actions">
              <button class="btn btn-primary" type="submit">
                ${hasResponse ? "Update response" : "Send response"}
              </button>
            </div>
          </form>
        `
        : "";

      return `
        <tr>
          ${
            isConsultant
              ? `<td>${requester}</td>`
              : ""
          }

          <td>
            <strong>${esc(item.subject)}</strong>
          </td>

          <td>
            <div style="white-space:pre-wrap">${esc(item.description)}</div>
          </td>

          <td>
            ${responseContent}
            ${replyForm}
          </td>

          <td>${badge(item.status)}</td>

          <td>${date(item.created_at)}</td>
        </tr>
      `;
    });

    container.innerHTML = table(headers, rows);
  } catch (error) {
    container.innerHTML = `
      <div class="table-empty">${esc(error.message)}</div>
    `;
  }
}

/* ---------- Save consultant response ---------- */

async function submitConsultancyReply(event) {
  event.preventDefault();

  // The submit event is delegated to document, so use event.target.
  const form = event.target.closest(".consultancy-reply-form");
  if (!form) return;

  const requestId = form.dataset.requestId;
  const response = form.elements.response.value.trim();
  const button = form.querySelector('[type="submit"]');

  if (!response) {
    return toast(
      "Please enter a response before submitting.",
      "error"
    );
  }

  if (response.length > 5000) {
    return toast(
      "Your response must not exceed 5000 characters.",
      "error"
    );
  }

  if (button) button.disabled = true;

  try {
    const data = await request(
      `/consultancy/${encodeURIComponent(requestId)}/respond`,
      {
        method: "POST",
        body: JSON.stringify({ response }),
      }
    );

    toast(
      data.message || "Consultancy response saved successfully.",
      "success"
    );

    // Refresh the queue to show the saved answer and new status.
    await loadConsultancyHistory();
    await renderOverview();
  } catch (error) {
    report(error);
  } finally {
    // The original button may disappear when the table is rerendered.
    if (button?.isConnected) {
      button.disabled = false;
    }
  }
}

/* ---------- Farmer inventory ---------- */

function renderInventory() {
  const el = $("#farmerInventory");

  if (!el || state.user?.role !== "farmer") return;

  const mine = state.commodities.filter(
    (commodity) =>
      Number(commodity.seller_id) === Number(state.user.id)
  );

  el.innerHTML = table(
    ["Commodity", "Price", "Available stock", "Listed"],

    mine.map(
      (commodity) => `
        <tr>
          <td><strong>${esc(commodity.name)}</strong></td>
          <td>${money(commodity.price)} / ${esc(commodity.unit)}</td>
          <td>${esc(commodity.quantity)} ${esc(commodity.unit)}</td>
          <td>${date(commodity.created_at)}</td>
        </tr>
      `
    )
  );
}

/* ---------- Booking status updates ---------- */

async function updateBookingStatus(id, status, button) {
  if (!confirm(`Change this booking status to ${status}?`)) return;

  button.disabled = true;

  try {
    await request(
      `/bookings/${encodeURIComponent(id)}/status`,
      {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }
    );

    toast("Booking status updated.", "success");

    await Promise.all([
      loadFarmerBookings(),
      loadCommodities(),
    ]);

    renderOverview();
  } catch (error) {
    report(error);
    button.disabled = false;
  }
}

/* ---------- Booking flow ---------- */

function startBooking(item) {
  const { user } = state;

  if (!user) {
    openAuth("login");
    return toast("Log in as a buyer to book a commodity.");
  }

  if (user.role !== "buyer") {
    return toast(
      "Only buyer accounts can book commodities.",
      "error"
    );
  }

  if (Number(item.quantity) <= 0) {
    return toast(
      "This commodity is currently out of stock.",
      "error"
    );
  }

  state.selected = item;

  $("#bookingCommodityDetails").innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <h3>${esc(item.name)}</h3>
        <p>Farmer: ${esc(item.seller_name || "ACBCS farmer")}</p>
        <strong>${money(item.price)} / ${esc(item.unit)}</strong>
      </div>

      <span class="role-badge">
        ${esc(item.quantity)} ${esc(item.unit)} available
      </span>
    </div>
  `;

  $("#bookingStockInfo").textContent =
    `Available stock: ${item.quantity} ${item.unit}`;

  $("#bookingEstimate").textContent = "";
  feedback("#bookingFormStatus", "");

  const form = $("#bookingForm");

  form.elements.commodityId.value = item.id;
  form.elements.quantity.max = item.quantity;
  form.elements.quantity.value = "";

  showDashboard({ tab: "bookingForm" });
}

/* ---------- Form submission helper ---------- */

async function submitForm(
  event,
  {
    path,
    status,
    pending,
    build = (values) => values,
    done,
  }
) {
  event.preventDefault();

  const form = event.currentTarget;
  const submit = $('[type="submit"]', form);

  if (submit) submit.disabled = true;

  feedback(status, pending);

  try {
    const values = build(
      Object.fromEntries(new FormData(form))
    );

    const data = await request(path, {
      method: "POST",
      body: JSON.stringify(values),
    });

    await done(data, form, values);
  } catch (error) {
    if (!(error instanceof SessionError)) {
      feedback(status, error.message, "error");
    }
  } finally {
    if (submit) submit.disabled = false;
  }
}

/* ---------- Login ---------- */

const submitLogin = (event) =>
  submitForm(event, {
    path: "/auth/login",
    status: "#loginStatus",
    pending: "Signing in...",

    async done(data, form) {
      if (!data.token || !data.user) {
        throw new Error(
          "The server returned an invalid login response."
        );
      }

      setSession(data.user, data.token);

      form.reset();
      closeAuth();
      renderHeader();

      await loadCommodities();

      showDashboard();

      toast(`Welcome, ${data.user.fullName}.`, "success");
    },
  });

/* ---------- Registration ---------- */

const submitRegistration = (event) =>
  submitForm(event, {
    path: "/auth/register",
    status: "#registerStatus",
    pending: "Creating your account...",

    done(data, form, values) {
      form.reset();
      switchAuth("login");

      const loginForm = $("#loginForm");

      if (loginForm?.elements.email) {
        loginForm.elements.email.value = values.email || "";
      }

      feedback(
        "#loginStatus",
        data.message || "Registration successful. Please log in.",
        "success"
      );

      toast("Account created. Please log in.", "success");
    },
  });

/* ---------- Add commodity ---------- */

const submitCommodity = (event) =>
  submitForm(event, {
    path: "/commodities",
    status: "#commodityFormStatus",
    pending: "Publishing listing...",

    build(values) {
      const price = Number(values.price);
      const quantity = Number(values.quantity);

      if (
        !values.name?.trim() ||
        !(price > 0) ||
        !(quantity > 0)
      ) {
        throw new Error(
          "Enter a commodity name, a valid price and a valid quantity."
        );
      }

      return {
        ...values,
        name: values.name.trim(),
        price,
        quantity,
      };
    },

    async done(data, form) {
      form.reset();
      form.classList.add("hidden");

      feedback("#commodityFormStatus", "");

      toast("Commodity listed successfully.", "success");

      await loadCommodities();
      renderOverview();
    },
  });

/* ---------- Submit booking ---------- */

const submitBooking = (event) =>
  submitForm(event, {
    path: "/bookings",
    status: "#bookingFormStatus",
    pending: "Submitting booking...",

    build(values) {
      const item = state.selected;
      const quantity = Number(values.quantity);

      if (!item) {
        throw new Error(
          "Select a commodity before submitting your booking."
        );
      }

      if (!(quantity > 0)) {
        throw new Error("Enter a valid quantity.");
      }

      if (quantity > Number(item.quantity)) {
        throw new Error(
          "Requested quantity exceeds available stock."
        );
      }

      return {
        commodityId: Number(item.id),
        quantity,
      };
    },

    async done() {
      state.selected = null;

      toast("Your booking has been submitted.", "success");

      await loadCommodities();
      switchTab("bookings");
    },
  });

/* ---------- Submit consultancy request ---------- */

const submitConsultancy = (event) =>
  submitForm(event, {
    path: "/consultancy",
    status: "#consultancyFormStatus",
    pending: "Submitting request...",

    async done(data, form) {
      form.reset();

      feedback(
        "#consultancyFormStatus",
        "Consultancy request submitted successfully.",
        "success"
      );

      toast("Consultancy request submitted.", "success");

      await loadConsultancyHistory();
      await renderOverview();
    },
  });

/* ---------- Event wiring ---------- */

function wire() {
  // Handle dynamically created consultant reply forms.
  document.addEventListener("submit", (event) => {
    if (event.target.matches?.(".consultancy-reply-form")) {
      submitConsultancyReply(event);
    }
  });

  // Delegated clicks: auth, navigation, bookings and status controls.
  document.addEventListener("click", (event) => {
    const target = event.target;

    const auth = target.closest("[data-open-auth]");

    if (auth) {
      return openAuth(auth.dataset.openAuth);
    }

    const action = target.closest("[data-action]")?.dataset.action;

    if (action === "logout") return logout();
    if (action === "dashboard") return showDashboard();

    if (target.closest("[data-close-modal]")) {
      return closeAuth();
    }

    if (target.closest("#mainNav a")) {
      return closeMenu();
    }

    const tab = target.closest(".dashboard-tab");

    if (tab) {
      return switchTab(tab.dataset.tab);
    }

    const book = target.closest("[data-book]");

    if (book) {
      const item = state.commodities.find(
        (commodity) =>
          Number(commodity.id) === Number(book.dataset.book)
      );

      return item && startBooking(item);
    }

    const status = target.closest("[data-status]");

    if (status) {
      updateBookingStatus(
        status.dataset.status,
        status.dataset.value,
        status
      );
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAuth();
  });

  // Replace broken commodity photos with their fallback icons.
  $("#commodityGrid")?.addEventListener(
    "error",
    (event) => {
      const img = event.target;

      if (!img.matches?.(".commodity-photo")) return;

      img.insertAdjacentHTML(
        "afterend",
        placeholder(img.dataset.icon, img.alt)
      );

      img.remove();
    },
    true
  );

  const clicks = {
    "#closeAuthModal": closeAuth,

    "#showLoginTab": () => switchAuth("login"),

    "#showRegisterTab": () => switchAuth("register"),

    "#refreshCommoditiesBtn": loadCommodities,

    "#refreshBookingsBtn": loadBuyerBookings,

    "#refreshFarmerBookingsBtn": loadFarmerBookings,

    "#refreshConsultancyBtn": loadConsultancyHistory,

    "#backToOverviewBtn": () => switchTab("overview"),

    "#menuToggle": () => {
      const nav = $("#mainNav");
      if (!nav) return;

      const open = nav.classList.toggle("open");

      $("#menuToggle")?.setAttribute(
        "aria-expanded",
        String(open)
      );
    },

    "#dashboardPrimaryBtn": () =>
      state.user?.role === "farmer"
        ? switchTab("inventory")
        : $("#marketplace")?.scrollIntoView({
            behavior: "smooth",
          }),

    "#consultancyBtn": () => {
      if (!state.user) return openAuth("login");

      if (state.user.role === "farmer") {
        return toast(
          "Consultancy requests are for buyers and consultants."
        );
      }

      showDashboard({ tab: "consultancy" });
    },

    "#showCommodityFormBtn": () => {
      const form = $("#commodityForm");
      if (!form) return;

      form.classList.remove("hidden");

      form.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },

    "#cancelCommodityFormBtn": () => {
      const form = $("#commodityForm");
      if (!form) return;

      form.reset();
      form.classList.add("hidden");

      feedback("#commodityFormStatus", "");
    },
  };

  Object.entries(clicks).forEach(([selector, handler]) => {
    $(selector)?.addEventListener("click", handler);
  });

  const submits = {
    "#loginForm": submitLogin,
    "#registerForm": submitRegistration,
    "#commodityForm": submitCommodity,
    "#bookingForm": submitBooking,
    "#consultancyForm": submitConsultancy,
  };

  Object.entries(submits).forEach(([selector, handler]) => {
    $(selector)?.addEventListener("submit", handler);
  });

  $("#commoditySearch")?.addEventListener(
    "input",
    renderCommodities
  );

  $("#commoditySort")?.addEventListener(
    "change",
    renderCommodities
  );

  $("#bookingForm")?.addEventListener("input", (event) => {
    if (event.target.name !== "quantity") return;

    const quantity = Number(event.target.value);
    const estimate = $("#bookingEstimate");

    if (!estimate) return;

    estimate.textContent =
      state.selected && quantity > 0
        ? `Estimated total: ${money(
            quantity * Number(state.selected.price)
          )}`
        : "";
  });

  // Recheck token expiry when the tab wakes up.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.token) {
      scheduleExpiry();
    }
  });

  // Synchronise sessions between browser tabs.
  window.addEventListener("storage", (event) => {
    if (event.key !== SESSION_KEY) return;

    if (!event.newValue && state.user) {
      logout("You were logged out in another tab.", "");
    } else if (event.newValue && !state.user) {
      location.reload();
    }
  });
}

/* ---------- Initialise application ---------- */

async function init() {
  const year = $("#currentYear");

  if (year) {
    year.textContent = new Date().getFullYear();
  }

  loadSession();
  renderHeader();
  wire();

  await loadCommodities();

  if (state.user) {
    showDashboard({ scroll: false });
  }
}

document.addEventListener("DOMContentLoaded", init);