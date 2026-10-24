"use strict";

const API = "/api";
const SESSION_KEY = "acbcs.session";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const state = { user: null, token: "", commodities: [], selected: null };
let expiryTimer, lastFocus;

/* ---------- Helpers ---------- */

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
const money = (v) => naira.format(Number(v) || 0);
const pretty = (v) => String(v || "").replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const badge = (s) => `<span class="status-badge ${esc(s)}">${esc(pretty(s))}</span>`;
const role = () => String(state.user?.role || "").toLowerCase();
const text = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
const hide = (sel, hidden = true) => $(sel)?.classList.toggle("hidden", hidden);
const smoothScroll = (el, block) => el?.scrollIntoView({ behavior: "smooth", block });

const date = (v) => {
  const d = new Date(String(v ?? "").replace(" ", "T"));
  return isNaN(d)
    ? "-"
    : d.toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
};

function toast(message, type = "") {
  const el = Object.assign(document.createElement("div"), { className: `toast ${type}`, textContent: message });
  $("#toastRegion")?.append(el);
  setTimeout(() => el.remove(), 4000);
}

function feedback(sel, message, type = "") {
  const el = $(sel);
  if (el) Object.assign(el, { textContent: message, className: `form-feedback ${type}`.trim() });
}

/* ---------- API ---------- */

class SessionError extends Error {}
const report = (e) => e instanceof SessionError || toast(e.message, "error");
const EXPIRED = "Your session has expired. Please log in again.";

async function request(path, { headers, ...options } = {}) {
  const h = { ...headers };
  if (options.body !== undefined) h["Content-Type"] = "application/json";
  if (state.token) h.Authorization = `Bearer ${state.token}`;

  let res;
  try {
    res = await fetch(API + path, { ...options, headers: h });
  } catch {
    throw new Error("Cannot reach the server. Check that ACBCS is running.");
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && state.token) {
    logout(EXPIRED, "error");
    throw new SessionError("Session expired.");
  }
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status}).`);
  return data;
}

const post = (path, body, method = "POST") =>
  request(path, { method, body: JSON.stringify(body) });

/* ---------- Session ---------- */

function tokenExpiry(token) {
  try {
    const { exp } = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return exp ? exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  const at = tokenExpiry(state.token);
  if (!at) return;

  const wait = at - Date.now();
  if (wait <= 0) logout(EXPIRED, "error");
  else expiryTimer = setTimeout(scheduleExpiry, Math.min(wait, 2 ** 31 - 1));
}

function loadSession() {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("authToken");

  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    const at = session?.token && tokenExpiry(session.token);

    if (session?.user && session?.token && !(at && at <= Date.now())) {
      Object.assign(state, session);
      scheduleExpiry();
      return;
    }
  } catch {
    // Invalid saved session; cleared below.
  }
  localStorage.removeItem(SESSION_KEY);
}

function setSession(user, token) {
  Object.assign(state, { user, token });
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token }));
  scheduleExpiry();
}

function logout(message = "You have been logged out.", type = "success") {
  clearTimeout(expiryTimer);
  Object.assign(state, { user: null, token: "", selected: null });
  localStorage.removeItem(SESSION_KEY);

  $$("form").forEach((f) => f.reset());
  hide("#dashboard");
  closeAuth();
  closeMenu();
  renderHeader();
  renderCommodities();
  window.scrollTo({ top: 0, behavior: "smooth" });

  if (message) toast(message, type);
}

/* ---------- Header and menu ---------- */

function renderHeader() {
  const header = $("#headerActions");
  if (!header) return;

  header.innerHTML = state.user
    ? `<span class="header-user">${esc(state.user.fullName)}</span>
       <button class="btn btn-primary" type="button" data-action="dashboard">My workspace</button>
       <button class="btn btn-outline" type="button" data-action="logout">Log out</button>`
    : `<button class="btn btn-outline" type="button" data-open-auth="login">Log in</button>
       <button class="btn btn-primary" type="button" data-open-auth="register">Get started <span aria-hidden="true">↗</span></button>`;
}

function closeMenu() {
  $("#mainNav")?.classList.remove("open");
  $("#menuToggle")?.setAttribute("aria-expanded", "false");
}

/* ---------- Auth modal ---------- */

const AUTH_COPY = {
  login: ["WELCOME BACK", "Welcome back.", "Sign in to continue to your account."],
  register: ["JOIN THE ACBCS COMMUNITY", "Create your account.", "Choose your role and get started."],
};

function switchAuth(mode = "login") {
  for (const m of ["login", "register"]) {
    hide(`#${m}Form`, m !== mode);
    const tab = $(`#show${pretty(m)}Tab`);
    tab?.classList.toggle("active", m === mode);
    tab?.setAttribute("aria-selected", String(m === mode));
  }

  ["#authEyebrow", "#authTitle", "#authSubtitle"].forEach((sel, i) => text(sel, AUTH_COPY[mode][i]));
  feedback("#loginStatus", "");
  feedback("#registerStatus", "");
}

function openAuth(mode = "login") {
  lastFocus = document.activeElement;
  hide("#authModal", false);
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

/* ---------- Commodity visuals ---------- */

const PRODUCE = [
  [["maize", "corn"], "🌽", "corn.jpg"],
  [["rice"], "🌾", "rice.jpg"],
  [["cassava"], "🥔", "cassava.jpg"],
  [["garri"], "🥔", "Garri.jpg"],
  [["yam"], "🥔", "yam.jpg"],
  [["soybean", "soya"], "🌱", "soybean.jpg"],
  [["beans", "bean"], "🫘", "beans.jpg"],
  [["cocoa"], "🍫", "cocoa.jpg"],
  [["tomato"], "🍅", "tomatoes.jpg"],
  [["pepper"], "🌶️", "pepper.jpg"],
  [["palm"], "🌴", "palm oil.jpg"],
  [["groundnut", "peanut"], "🥜", "groundnut.jpg"],
  [["wheat"], "🌾", "wheat.jpg"],
  [["poultry", "chicken"], "🐔", "chicken.jpg"],
  [["turkey"], "🦃", "turkey.jpg"],
  [["egg"], "🥚", "eggs.jpg"],
  [["onion"], "🧅", "onions.jpg"],
  [["plantain"], "🍌", "plantain.jpg"],
  [["fish"], "🐟", "fish.jpg"],
];

const placeholder = (icon, label) =>
  `<div class="commodity-placeholder" role="img" aria-label="${esc(label)}">${icon}</div>`;

function commodityVisual({ name }) {
  const n = String(name || "").toLowerCase();
  const match = PRODUCE.find(([words]) => words.some((w) => n.includes(w)));
  if (!match) return placeholder("🌿", name);

  const [, icon, image] = match;
  return `<img class="commodity-photo" src="/images/${encodeURIComponent(image)}"
    alt="${esc(name)}" data-icon="${icon}" loading="lazy">`;
}

/* ---------- Marketplace ---------- */

const SORTERS = {
  "price-low": (a, b) => a.price - b.price,
  "price-high": (a, b) => b.price - a.price,
  name: (a, b) => String(a.name).localeCompare(String(b.name)),
  newest: (a, b) => b.id - a.id,
};

function commodityCard(item) {
  const stock = Number(item.quantity) || 0;
  const own = state.user?.role === "farmer" && Number(state.user.id) === Number(item.seller_id);
  const label = own ? "Your listing" : stock <= 0 ? "Unavailable" : "Book now ↗";

  return `
    <article class="commodity-card">
      <div class="commodity-image">
        ${commodityVisual(item)}
        <span class="stock-badge">${stock > 0 ? `${esc(stock)} ${esc(item.unit)} available` : "Out of stock"}</span>
      </div>
      <div class="commodity-content">
        <h3>${esc(item.name)}</h3>
        <p class="commodity-description">${esc(item.description || "Agricultural commodity listed on ACBCS.")}</p>
        <div class="commodity-meta">
          <div>
            <div class="commodity-price">${money(item.price)} <small>/ ${esc(item.unit)}</small></div>
            <div class="commodity-seller">Farmer: <strong>${esc(item.seller_name || "ACBCS farmer")}</strong></div>
          </div>
          <button class="book-button" type="button" data-book="${Number(item.id)}"
            ${stock <= 0 || own ? "disabled" : ""}>${label}</button>
        </div>
      </div>
    </article>`;
}

function renderCommodities() {
  const grid = $("#commodityGrid");
  if (!grid) return;

  const query = ($("#commoditySearch")?.value || "").trim().toLowerCase();
  const sorter = SORTERS[$("#commoditySort")?.value] || SORTERS.newest;

  const items = state.commodities
    .filter((c) => [c.name, c.description, c.seller_name, c.unit].join(" ").toLowerCase().includes(query))
    .sort((a, b) => sorter(
      { ...a, price: Number(a.price), id: Number(a.id) },
      { ...b, price: Number(b.price), id: Number(b.id) }
    ));

  hide("#commodityEmpty", items.length > 0);
  grid.innerHTML = items.map(commodityCard).join("");
}

async function loadCommodities() {
  const grid = $("#commodityGrid");
  if (!grid) return;

  if (!state.commodities.length) {
    grid.innerHTML = '<div class="loading-state">Loading agricultural commodities...</div>';
  }
  text("#marketStatus", "");

  try {
    const data = await request("/commodities");
    state.commodities = Array.isArray(data.commodities) ? data.commodities : [];

    renderCommodities();
    text("#marketStatus", `${state.commodities.length} commodity listing(s) available.`);
    if (state.user?.role === "farmer") renderInventory();
  } catch (e) {
    grid.innerHTML = `<div class="loading-state">${esc(e.message)}
      <p>Check your connection and refresh the listings.</p></div>`;
    text("#marketStatus", "Unable to load commodity listings.");
  }
}

/* ---------- Roles and dashboard ---------- */

const ROLES = {
  buyer: {
    welcome: "Discover produce, create bookings and follow their progress.",
    stat: ["/bookings/my", "My bookings", "bookings"],
  },
  farmer: {
    welcome: "Manage your listings, available stock and incoming bookings.",
    stat: ["/bookings/farmer", "Incoming bookings", "bookings"],
  },
  consultant: {
    welcome: "Review incoming agricultural consultancy requests.",
    stat: ["/consultancy/queue", "Incoming consultancy requests", "requests"],
    staff: true,
  },
};
ROLES.admin = { ...ROLES.consultant, welcome: "Manage ACBCS activities and review consultancy requests." };

const roleConfig = () => ROLES[role()] || {};

const TAB_LOADERS = {
  overview: () => renderOverview(),
  bookings: () => loadBuyerBookings(),
  inventory: () => renderInventory(),
  farmerBookings: () => loadFarmerBookings(),
  consultancy: () => loadConsultancyHistory(),
};

function switchTab(tab) {
  $$(".dashboard-tab").forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });
  $$(".dashboard-panel").forEach((p) => p.classList.toggle("hidden", p.id !== `panel-${tab}`));
  TAB_LOADERS[tab]?.();
}

function showDashboard({ tab = "overview", scroll = true } = {}) {
  if (!state.user) return openAuth("login");

  const { role: userRole, fullName } = state.user;
  const config = roleConfig();
  const staff = Boolean(config.staff);

  hide("#dashboard", false);
  text("#dashboardName", fullName);
  text("#dashboardRole", pretty(userRole).toUpperCase());
  text("#dashboardWelcomeText", config.welcome || "Manage your ACBCS activities.");

  const primary = $("#dashboardPrimaryBtn");
  if (primary) {
    primary.innerHTML = `${userRole === "farmer" ? "Manage commodities" : "Explore marketplace"} <span aria-hidden="true">↗</span>`;
  }

  $$("#dashboardTabs [data-roles]").forEach((b) => {
    b.hidden = !b.dataset.roles.split(" ").includes(userRole);
  });

  // Buyers submit questions; consultants and admins answer them.
  const form = $("#consultancyForm");
  if (form) form.hidden = staff;
  hide("#consultancyForm", staff);

  text(
    "#panel-consultancy .panel-heading p",
    staff
      ? "Review incoming questions and send agricultural advice."
      : "Submit a request and review your consultant's responses."
  );
  text(".history-heading h3", staff ? "Incoming consultancy requests" : "My consultancy requests");

  switchTab(tab);
  if (scroll) smoothScroll($("#dashboard"), "start");
}

async function renderOverview() {
  const box = $("#dashboardCards");
  const user = state.user;
  if (!box || !user) return;

  const [path, label, key] = roleConfig().stat || [];
  let count = state.commodities.length;

  if (path) {
    try {
      const data = await request(path);
      count = Number(data.count ?? data[key]?.length) || 0;
    } catch (e) {
      report(e);
      count = "-";
    }
  }
  if (!state.user) return;

  box.innerHTML = `
    <div class="dashboard-stat"><span>Account type</span><strong>${esc(pretty(user.role))}</strong></div>
    <div class="dashboard-stat"><span>Account email</span><strong class="stat-small">${esc(user.email)}</strong></div>
    <div class="dashboard-stat"><span>${esc(label || "Marketplace listings")}</span><strong>${esc(count)}</strong></div>`;
}

/* ---------- Tables ---------- */

const table = (headers, rows) =>
  rows.length
    ? `<table class="data-table">
        <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>`
    : '<div class="table-empty">Nothing to display yet.</div>';

async function loadTable({ target, path, key, headers, row, loading }) {
  const el = $(target);
  if (!el) return;

  el.innerHTML = `<div class="table-empty">${esc(loading)}</div>`;

  try {
    const data = await request(path);
    if (!state.user) return;
    el.innerHTML = table(headers, (Array.isArray(data[key]) ? data[key] : []).map(row));
  } catch (e) {
    el.innerHTML = `<div class="table-empty">${esc(e.message)}</div>`;
  }
}

const loadBuyerBookings = () =>
  loadTable({
    target: "#buyerBookings",
    path: "/bookings/my",
    key: "bookings",
    loading: "Loading bookings...",
    headers: ["Commodity", "Farmer", "Quantity", "Unit price", "Status", "Date", "Action"],
    row: (b) => `<tr>
      <td><strong>${esc(b.commodity_name)}</strong></td>
      <td>${esc(b.farmer_name)}</td>
      <td>${esc(b.quantity)} ${esc(b.unit)}</td>
      <td>${money(b.price)}</td>
      <td>${badge(b.status)}</td>
      <td>${date(b.created_at)}</td>
      <td>${["pending", "confirmed"].includes(b.status)
        ? `<button class="btn btn-outline" type="button" data-cancel-booking="${Number(b.id)}">Cancel</button>`
        : "-"}</td>
    </tr>`,
  });

const NEXT_STATUS = {
  pending: [["confirmed", "Confirm", "btn-primary"], ["rejected", "Reject", "btn-outline"]],
  confirmed: [["completed", "Complete", "btn-primary"]],
};

const loadFarmerBookings = () =>
  loadTable({
    target: "#farmerBookings",
    path: "/bookings/farmer",
    key: "bookings",
    loading: "Loading incoming bookings...",
    headers: ["Commodity", "Buyer", "Quantity", "Status", "Date", "Action"],
    row: (b) => `<tr>
      <td>${esc(b.commodity_name)}</td>
      <td>${esc(b.buyer_name)}</td>
      <td>${esc(b.quantity)}</td>
      <td>${badge(b.status)}</td>
      <td>${date(b.created_at)}</td>
      <td>${(NEXT_STATUS[b.status] || [])
        .map(([v, t, cls]) =>
          `<button class="btn ${cls}" type="button" data-status="${Number(b.id)}" data-value="${v}">${t}</button>`)
        .join("") || "-"}</td>
    </tr>`,
  });

/* ---------- Consultancy ---------- */

const PRE = "white-space:pre-wrap";

function consultancyRow(staff) {
  return (r) => {
    const answered = typeof r.response === "string" && r.response.trim().length > 0;

    const requester = r.requester_name
      ? `<strong>${esc(r.requester_name)}</strong>${r.requester_email ? `<br><small>${esc(r.requester_email)}</small>` : ""}`
      : `User #${esc(r.user_id)}`;

    const response = answered
      ? `<div style="${PRE}">${esc(r.response)}</div>`
      : `<span>${staff ? "Not answered yet" : "Awaiting consultant response"}</span>`;

    const reply = staff
      ? `<form class="consultancy-reply-form" data-request-id="${Number(r.id)}">
          <textarea name="response" rows="4" maxlength="5000" required
            aria-label="Consultant response to ${esc(r.subject)}"
            placeholder="Write your agricultural advice...">${esc(r.response || "")}</textarea>
          <div class="reply-form-actions">
            <button class="btn btn-primary" type="submit">${answered ? "Update response" : "Send response"}</button>
          </div>
        </form>`
      : "";

    // Assign is for staff on pending requests. Cancel is only offered on a
    // request the current user submitted (the API rejects cancelling anyone else's).
    const open = ["pending", "assigned"].includes(r.status);
    const own = !staff || Number(r.user_id) === Number(state.user?.id);
    const actions = [];
    if (staff && r.status === "pending") {
      actions.push(`<button class="btn btn-primary" type="button" data-assign-request="${Number(r.id)}">Assign to me</button>`);
    }
    if (open && own) {
      actions.push(`<button class="btn btn-outline" type="button" data-cancel-request="${Number(r.id)}">Cancel</button>`);
    }

    return `<tr>
      ${staff ? `<td>${requester}</td>` : ""}
      <td><strong>${esc(r.subject)}</strong></td>
      <td><div style="${PRE}">${esc(r.description)}</div></td>
      <td>${response}${reply}</td>
      <td>${badge(r.status)}</td>
      <td>${date(r.created_at)}</td>
      <td>${actions.join(" ") || "-"}</td>
    </tr>`;
  };
}

function loadConsultancyHistory() {
  const staff = ["consultant", "admin"].includes(role());
  const base = ["Subject", "Question", "Consultant response", "Status", "Date", "Action"];

  return loadTable({
    target: "#consultancyHistory",
    path: staff ? "/consultancy/queue" : "/consultancy/my",
    key: "requests",
    loading: `Loading ${staff ? "incoming consultancy requests" : "your consultancy requests"}...`,
    headers: staff ? ["Requester", ...base] : base,
    row: consultancyRow(staff),
  });
}

async function submitConsultancyReply(event) {
  event.preventDefault();

  const form = event.target.closest(".consultancy-reply-form");
  if (!form) return;

  const response = form.elements.response.value.trim();
  const button = form.querySelector('[type="submit"]');

  if (!response) return toast("Please enter a response before submitting.", "error");
  if (response.length > 5000) return toast("Your response must not exceed 5000 characters.", "error");

  button.disabled = true;

  try {
    const data = await post(`/consultancy/${encodeURIComponent(form.dataset.requestId)}/respond`, { response });
    toast(data.message || "Consultancy response saved successfully.", "success");
    await loadConsultancyHistory();
    await renderOverview();
  } catch (e) {
    report(e);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

/* ---------- Farmer inventory ---------- */

function renderInventory() {
  const el = $("#farmerInventory");
  if (!el || state.user?.role !== "farmer") return;

  const mine = state.commodities.filter((c) => Number(c.seller_id) === Number(state.user.id));

  el.innerHTML = table(
    ["Commodity", "Price", "Available stock", "Listed"],
    mine.map((c) => `<tr>
      <td><strong>${esc(c.name)}</strong></td>
      <td>${money(c.price)} / ${esc(c.unit)}</td>
      <td>${esc(c.quantity)} ${esc(c.unit)}</td>
      <td>${date(c.created_at)}</td>
    </tr>`)
  );
}

async function updateBookingStatus(id, status, button) {
  if (!confirm(`Change this booking status to ${status}?`)) return;
  button.disabled = true;

  try {
    await post(`/bookings/${encodeURIComponent(id)}/status`, { status }, "PATCH");
    toast("Booking status updated.", "success");
    await Promise.all([loadFarmerBookings(), loadCommodities()]);
    renderOverview();
  } catch (e) {
    report(e);
    button.disabled = false;
  }
}

async function cancelBooking(id, button) {
  if (!confirm("Cancel this booking? Reserved stock will be returned to the farmer.")) return;
  button.disabled = true;

  try {
    const data = await post(`/bookings/${encodeURIComponent(id)}/cancel`, undefined, "PATCH");
    toast(data.message || "Booking cancelled successfully.", "success");
    await Promise.all([loadBuyerBookings(), loadCommodities()]);
    renderOverview();
  } catch (e) {
    report(e);
    button.disabled = false;
  }
}

async function assignConsultancyRequest(id, button) {
  button.disabled = true;

  try {
    const data = await post(`/consultancy/${encodeURIComponent(id)}/assign`, undefined);
    toast(data.message || "Consultancy request assigned successfully.", "success");
    await loadConsultancyHistory();
    await renderOverview();
  } catch (e) {
    report(e);
    button.disabled = false;
  }
}

async function cancelConsultancyRequest(id, button) {
  if (!confirm("Cancel this consultancy request?")) return;
  button.disabled = true;

  try {
    const data = await post(`/consultancy/${encodeURIComponent(id)}/cancel`, undefined, "PATCH");
    toast(data.message || "Consultancy request cancelled successfully.", "success");
    await loadConsultancyHistory();
    await renderOverview();
  } catch (e) {
    report(e);
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
  if (user.role !== "buyer") return toast("Only buyer accounts can book commodities.", "error");
  if (Number(item.quantity) <= 0) return toast("This commodity is currently out of stock.", "error");

  state.selected = item;

  $("#bookingCommodityDetails").innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <h3>${esc(item.name)}</h3>
        <p>Farmer: ${esc(item.seller_name || "ACBCS farmer")}</p>
        <strong>${money(item.price)} / ${esc(item.unit)}</strong>
      </div>
      <span class="role-badge">${esc(item.quantity)} ${esc(item.unit)} available</span>
    </div>`;

  text("#bookingStockInfo", `Available stock: ${item.quantity} ${item.unit}`);
  text("#bookingEstimate", "");
  feedback("#bookingFormStatus", "");

  const { elements } = $("#bookingForm");
  elements.commodityId.value = item.id;
  elements.quantity.max = item.quantity;
  elements.quantity.value = "";

  showDashboard({ tab: "bookingForm" });
}

/* ---------- Form submission ---------- */

async function submitForm(event, { path, status, pending, build = (v) => v, done }) {
  event.preventDefault();

  const form = event.currentTarget;
  const submit = $('[type="submit"]', form);
  if (submit) submit.disabled = true;

  feedback(status, pending);

  try {
    const values = build(Object.fromEntries(new FormData(form)));
    await done(await post(path, values), form, values);
  } catch (e) {
    if (!(e instanceof SessionError)) feedback(status, e.message, "error");
  } finally {
    if (submit) submit.disabled = false;
  }
}

const submitLogin = (e) =>
  submitForm(e, {
    path: "/auth/login",
    status: "#loginStatus",
    pending: "Signing in...",
    async done(data, form) {
      if (!data.token || !data.user) throw new Error("The server returned an invalid login response.");

      setSession(data.user, data.token);
      form.reset();
      closeAuth();
      renderHeader();
      await loadCommodities();
      showDashboard();
      toast(`Welcome, ${data.user.fullName}.`, "success");
    },
  });

const submitRegistration = (e) =>
  submitForm(e, {
    path: "/auth/register",
    status: "#registerStatus",
    pending: "Creating your account...",
    done(data, form, values) {
      form.reset();
      switchAuth("login");

      const email = $("#loginForm")?.elements.email;
      if (email) email.value = values.email || "";

      feedback("#loginStatus", data.message || "Registration successful. Please log in.", "success");
      toast("Account created. Please log in.", "success");
    },
  });

const submitCommodity = (e) =>
  submitForm(e, {
    path: "/commodities",
    status: "#commodityFormStatus",
    pending: "Publishing listing...",
    build(values) {
      const price = Number(values.price);
      const quantity = Number(values.quantity);

      if (!values.name?.trim() || !(price > 0) || !(quantity > 0)) {
        throw new Error("Enter a commodity name, a valid price and a valid quantity.");
      }
      return { ...values, name: values.name.trim(), price, quantity };
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

const submitBooking = (e) =>
  submitForm(e, {
    path: "/bookings",
    status: "#bookingFormStatus",
    pending: "Submitting booking...",
    build(values) {
      const item = state.selected;
      const quantity = Number(values.quantity);

      if (!item) throw new Error("Select a commodity before submitting your booking.");
      if (!(quantity > 0)) throw new Error("Enter a valid quantity.");
      if (quantity > Number(item.quantity)) throw new Error("Requested quantity exceeds available stock.");

      return { commodityId: Number(item.id), quantity };
    },
    async done() {
      state.selected = null;
      toast("Your booking has been submitted.", "success");
      await loadCommodities();
      switchTab("bookings");
    },
  });

const submitConsultancy = (e) =>
  submitForm(e, {
    path: "/consultancy",
    status: "#consultancyFormStatus",
    pending: "Submitting request...",
    async done(data, form) {
      form.reset();
      feedback("#consultancyFormStatus", "Consultancy request submitted successfully.", "success");
      toast("Consultancy request submitted.", "success");
      await loadConsultancyHistory();
      await renderOverview();
    },
  });

/* ---------- Event wiring ---------- */

function wire() {
  // Reply forms are created dynamically, so listen on the document.
  document.addEventListener("submit", (e) => {
    if (e.target.matches?.(".consultancy-reply-form")) submitConsultancyReply(e);
  });

  document.addEventListener("click", ({ target }) => {
    const auth = target.closest("[data-open-auth]");
    if (auth) return openAuth(auth.dataset.openAuth);

    const action = target.closest("[data-action]")?.dataset.action;
    if (action === "logout") return logout();
    if (action === "dashboard") return showDashboard();

    if (target.closest("[data-close-modal]")) return closeAuth();
    if (target.closest("#mainNav a")) return closeMenu();

    const tab = target.closest(".dashboard-tab");
    if (tab) return switchTab(tab.dataset.tab);

    const book = target.closest("[data-book]");
    if (book) {
      const item = state.commodities.find((c) => Number(c.id) === Number(book.dataset.book));
      return item && startBooking(item);
    }

    const status = target.closest("[data-status]");
    if (status) updateBookingStatus(status.dataset.status, status.dataset.value, status);

    const cancelBtn = target.closest("[data-cancel-booking]");
    if (cancelBtn) cancelBooking(cancelBtn.dataset.cancelBooking, cancelBtn);

    const assignBtn = target.closest("[data-assign-request]");
    if (assignBtn) assignConsultancyRequest(assignBtn.dataset.assignRequest, assignBtn);

    const cancelReqBtn = target.closest("[data-cancel-request]");
    if (cancelReqBtn) cancelConsultancyRequest(cancelReqBtn.dataset.cancelRequest, cancelReqBtn);
  });

  document.addEventListener("keydown", (e) => e.key === "Escape" && closeAuth());

  // Swap broken commodity photos for their fallback icon.
  $("#commodityGrid")?.addEventListener(
    "error",
    ({ target: img }) => {
      if (!img.matches?.(".commodity-photo")) return;
      img.insertAdjacentHTML("afterend", placeholder(img.dataset.icon, img.alt));
      img.remove();
    },
    true
  );

  const resetCommodityForm = () => {
    const form = $("#commodityForm");
    if (!form) return;
    form.reset();
    form.classList.add("hidden");
    feedback("#commodityFormStatus", "");
  };

  const clicks = {
    "#closeAuthModal": closeAuth,
    "#showLoginTab": () => switchAuth("login"),
    "#showRegisterTab": () => switchAuth("register"),
    "#refreshCommoditiesBtn": loadCommodities,
    "#refreshBookingsBtn": loadBuyerBookings,
    "#refreshFarmerBookingsBtn": loadFarmerBookings,
    "#refreshConsultancyBtn": loadConsultancyHistory,
    "#backToOverviewBtn": () => switchTab("overview"),
    "#cancelCommodityFormBtn": resetCommodityForm,
    "#menuToggle": () => {
      const open = $("#mainNav")?.classList.toggle("open");
      $("#menuToggle").setAttribute("aria-expanded", String(Boolean(open)));
    },
    "#dashboardPrimaryBtn": () =>
      state.user?.role === "farmer" ? switchTab("inventory") : smoothScroll($("#marketplace")),
    "#consultancyBtn": () => {
      if (!state.user) return openAuth("login");
      if (state.user.role === "farmer") return toast("Consultancy requests are for buyers and consultants.");
      showDashboard({ tab: "consultancy" });
    },
    "#showCommodityFormBtn": () => {
      hide("#commodityForm", false);
      smoothScroll($("#commodityForm"), "center");
    },
  };

  const submits = {
    "#loginForm": submitLogin,
    "#registerForm": submitRegistration,
    "#commodityForm": submitCommodity,
    "#bookingForm": submitBooking,
    "#consultancyForm": submitConsultancy,
  };

  Object.entries(clicks).forEach(([s, fn]) => $(s)?.addEventListener("click", fn));
  Object.entries(submits).forEach(([s, fn]) => $(s)?.addEventListener("submit", fn));

  $("#commoditySearch")?.addEventListener("input", renderCommodities);
  $("#commoditySort")?.addEventListener("change", renderCommodities);

  $("#bookingForm")?.addEventListener("input", ({ target }) => {
    if (target.name !== "quantity") return;
    const qty = Number(target.value);
    text(
      "#bookingEstimate",
      state.selected && qty > 0 ? `Estimated total: ${money(qty * Number(state.selected.price))}` : ""
    );
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.token) scheduleExpiry();
  });

  // Keep sessions in sync across browser tabs.
  window.addEventListener("storage", ({ key, newValue }) => {
    if (key !== SESSION_KEY) return;
    if (!newValue && state.user) logout("You were logged out in another tab.", "");
    else if (newValue && !state.user) location.reload();
  });
}

/* ---------- Init ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  text("#currentYear", new Date().getFullYear());
  loadSession();
  renderHeader();
  wire();

  await loadCommodities();
  if (state.user) showDashboard({ scroll: false });
});