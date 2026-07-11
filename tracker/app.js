const SHEET_ID = "1_zPyjHCP6wDJJdMo-4VVguyTWs4JLJSbntwF8G6Hb3U";
const SHEET_GID = "0";
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
const SHEET_JSON_URL = `https://opensheet.elk.sh/${SHEET_ID}/Sheet1`;

const stages = [
  "Brief Received",
  "Payment Pending",
  "Paid",
  "In Queue",
  "Script/Plan Ready",
  "Image Production",
  "Video Production",
  "Editing",
  "First Preview Sent",
  "Revision",
  "Delivered",
  "Completed"
];

const input = document.querySelector("#orderId");
const button = document.querySelector("#checkBtn");
const result = document.querySelector("#result");

const fallbackOrders = Array.isArray(window.ORDERS) ? window.ORDERS : [];
let orders = [...fallbackOrders];
let sheetLoaded = false;
let sheetLoadError = "";

function normalize(value) {
  return String(value || "").trim().toUpperCase();
}

function compact(value) {
  return normalize(value).replace(/[^A-Z0-9]/g, "");
}

function safe(value) {
  return String(value || "").replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[char]));
}

function display(value, fallback = "Not set") {
  const text = String(value || "").trim();
  return text ? text : fallback;
}

function safeUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text, window.location.href);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    const next = csv[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

const headerAliases = {
  orderId: ["Order ID", "Receipt number", "Receipt no", "Receipt ID", "Tracking number", "Tracking ID", "Client ID"],
  clientName: ["Client name", "Client", "Customer name", "Customer"],
  country: ["Country", "Location"],
  phoneWhatsapp: ["Phone/WhatsApp", "WhatsApp", "Whatsapp number", "Phone", "Phone number", "Contact", "Contact number"],
  businessName: ["Business name", "Business", "Company", "Company name", "Brand"],
  videoLength: ["Video length", "Length", "Duration"],
  amount: ["Amount", "Price", "Paid amount", "Total"],
  paymentStatus: ["Payment status", "Payment", "Paid?"],
  datePaid: ["Date paid", "Paid date", "Payment date"],
  deadline: ["Deadline", "Due date"],
  status: ["Current status", "Status", "Project status"],
  queueNumber: ["Queue number", "Queue", "Queue no"],
  estimatedDelivery: ["Estimated delivery", "Delivery estimate", "ETA"],
  previewLink: ["Preview link", "Preview"],
  finalLink: ["Final delivery link", "Final link", "Delivery link", "Final video"],
  revisionUsed: ["Revision used?", "Revision used", "Revision"],
  notes: ["Notes", "Comment", "Comments", "Update"]
};

function hasOrderLikeValue(value) {
  return /^(SIN|ORDER|ORD|REC|TRACK)[-\s]?\d+/i.test(String(value || "").trim());
}

function findHeaderIndex(rows) {
  const directMatch = rows.findIndex(row => row.some(cell => {
    const key = compact(cell);
    return ["ORDERID", "RECEIPTNUMBER", "RECEIPTNO", "RECEIPTID", "TRACKINGNUMBER", "TRACKINGID"].includes(key);
  }));

  if (directMatch !== -1) return directMatch;

  const firstOrderRow = rows.findIndex(row => hasOrderLikeValue(row[0]));
  return firstOrderRow > 0 ? firstOrderRow - 1 : -1;
}

function buildHeaderLookup(headers) {
  const lookup = {};
  headers.forEach((header, index) => {
    const key = compact(header);
    if (key && !lookup[key]) lookup[key] = index;
  });
  return lookup;
}

function getField(headers, lookup, row, field) {
  const aliases = headerAliases[field] || [];
  const match = aliases.find(alias => lookup[compact(alias)] !== undefined);
  if (match) return row[lookup[compact(match)]] || "";

  if (field === "orderId" && !headers.some(header => compact(header) === "ORDERID")) {
    return row[0] || "";
  }

  return "";
}

function rowObjectToOrder(record) {
  const headers = Object.keys(record);
  const row = headers.map(header => record[header] || "");
  return rowToOrder(headers, row);
}

function rowToOrder(headers, row) {
  const lookup = buildHeaderLookup(headers);

  return {
    orderId: getField(headers, lookup, row, "orderId"),
    clientName: getField(headers, lookup, row, "clientName"),
    country: getField(headers, lookup, row, "country"),
    phoneWhatsapp: getField(headers, lookup, row, "phoneWhatsapp"),
    businessName: getField(headers, lookup, row, "businessName"),
    videoLength: getField(headers, lookup, row, "videoLength"),
    amount: getField(headers, lookup, row, "amount"),
    paymentStatus: getField(headers, lookup, row, "paymentStatus"),
    datePaid: getField(headers, lookup, row, "datePaid"),
    deadline: getField(headers, lookup, row, "deadline"),
    status: getField(headers, lookup, row, "status"),
    queueNumber: getField(headers, lookup, row, "queueNumber"),
    estimatedDelivery: getField(headers, lookup, row, "estimatedDelivery"),
    previewLink: getField(headers, lookup, row, "previewLink"),
    finalLink: getField(headers, lookup, row, "finalLink"),
    revisionUsed: getField(headers, lookup, row, "revisionUsed"),
    notes: getField(headers, lookup, row, "notes")
  };
}

async function loadOrdersFromJsonFeed() {
  const response = await fetch(SHEET_JSON_URL);
  if (!response.ok) throw new Error(`OpenSheet returned ${response.status}`);

  const records = await response.json();
  if (!Array.isArray(records)) throw new Error("OpenSheet returned invalid data");

  const sheetOrders = records
    .map(rowObjectToOrder)
    .filter(order => order.orderId);

  if (!sheetOrders.length) throw new Error("Google Sheet has no orders yet");
  return sheetOrders;
}

async function loadOrdersFromCsvFeed() {
  const response = await fetch(`${SHEET_CSV_URL}&cacheBust=${Date.now()}`);
  if (!response.ok) throw new Error(`Google Sheet returned ${response.status}`);

  const csv = await response.text();
  const rows = parseCsv(csv);
  const headerIndex = findHeaderIndex(rows);
  if (headerIndex === -1) throw new Error("Order/receipt/tracking header row not found");

  const headers = rows[headerIndex];
  const sheetOrders = rows
    .slice(headerIndex + 1)
    .map(row => rowToOrder(headers, row))
    .filter(order => order.orderId);

  if (!sheetOrders.length) throw new Error("Google Sheet has no orders yet");
  return sheetOrders;
}

async function loadOrdersFromSheet() {
  try {
    let sheetOrders;
    try {
      sheetOrders = await loadOrdersFromJsonFeed();
    } catch (jsonError) {
      console.warn("OpenSheet feed failed. Trying Google CSV feed:", jsonError);
      sheetOrders = await loadOrdersFromCsvFeed();
    }

    orders = sheetOrders;
    sheetLoaded = true;
    sheetLoadError = "";
  } catch (error) {
    console.warn("Using local fallback orders because Google Sheets could not load:", error);
    if (!orders.length) orders = [...fallbackOrders];
    sheetLoaded = true;
    sheetLoadError = error.message || "Google Sheet could not load";
  }
}

function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function findOrder(query) {
  const normalizedQuery = normalize(query);
  const queryDigits = digitsOnly(query);

  return orders.find(order => {
    const orderIdMatches = normalize(order.orderId) === normalizedQuery;
    const phoneDigits = digitsOnly(order.phoneWhatsapp);
    const phoneMatches = queryDigits && phoneDigits && (
      phoneDigits.endsWith(queryDigits) ||
      queryDigits.endsWith(phoneDigits)
    );

    return orderIdMatches || phoneMatches;
  });
}

function statusProgress(status) {
  const index = stages.indexOf(status);
  if (index === -1) return 0;
  return Math.round(((index + 1) / stages.length) * 100);
}

function renderLoading() {
  result.classList.remove("hidden");
  result.innerHTML = `<h2>Checking status...</h2><p>Please wait a moment.</p>`;
}

function renderOrder(order) {
  const status = display(order.status, "Status pending");
  const progress = statusProgress(status);
  const currentIndex = stages.indexOf(status);
  const previewLink = safeUrl(order.previewLink);
  const finalLink = safeUrl(order.finalLink);

  result.classList.remove("hidden");
  result.innerHTML = `
    <div class="status-header">
      <div>
        <h2>${safe(display(order.businessName, "SIN AI project"))}</h2>
        <p>Order ID: <strong>${safe(order.orderId)}</strong></p>
      </div>
      <div class="status-pill">${safe(status)}</div>
    </div>

    <div class="meta-grid">
      <div class="meta"><span>Client</span><strong>${safe(display(order.clientName))}</strong></div>
      <div class="meta"><span>Country</span><strong>${safe(display(order.country))}</strong></div>
      <div class="meta"><span>Video length</span><strong>${safe(display(order.videoLength))}</strong></div>
      <div class="meta"><span>Amount</span><strong>${safe(display(order.amount))}</strong></div>
      <div class="meta"><span>Payment</span><strong>${safe(display(order.paymentStatus, "Payment pending"))}</strong></div>
      <div class="meta"><span>Date paid</span><strong>${safe(display(order.datePaid, "Not paid yet"))}</strong></div>
      <div class="meta"><span>Deadline</span><strong>${safe(display(order.deadline))}</strong></div>
      <div class="meta"><span>Queue number</span><strong>${safe(display(order.queueNumber))}</strong></div>
      <div class="meta"><span>Estimated delivery</span><strong>${safe(display(order.estimatedDelivery))}</strong></div>
      <div class="meta"><span>Revision used?</span><strong>${safe(display(order.revisionUsed, "No"))}</strong></div>
      <div class="meta"><span>Notes</span><strong>${safe(display(order.notes, "No extra notes."))}</strong></div>
    </div>

    <div class="progress">
      <div class="progress-track"><div class="progress-bar" style="width:${progress}%"></div></div>
      <ul class="steps">
        ${stages.map((stage, index) => {
          const className = index < currentIndex ? "done" : index === currentIndex ? "current" : "";
          const icon = index < currentIndex ? "âœ“" : index === currentIndex ? "â—" : "â—‹";
          return `<li class="${className}"><span class="step-icon" aria-hidden="true">${icon}</span><span>${safe(stage)}</span></li>`;
        }).join("")}
      </ul>
    </div>

    ${previewLink ? `<p><a class="whatsapp" href="${safe(previewLink)}" target="_blank" rel="noreferrer">View Preview</a></p>` : ""}
    ${finalLink ? `<p><a class="whatsapp" href="${safe(finalLink)}" target="_blank" rel="noreferrer">Download Final Video</a></p>` : ""}
  `;
}

function renderError() {
  result.classList.remove("hidden");
  result.innerHTML = `
    <h2 class="error">Order not found</h2>
    <p>Please check your Order ID and try again. If the issue continues, contact SIN AI support.</p>
    ${sheetLoadError ? `<p class="sheet-warning">Sheet sync warning: ${safe(sheetLoadError)}</p>` : ""}
  `;
}

async function checkStatus() {
  if (!input.value.trim()) return renderError();

  renderLoading();
  await loadOrdersFromSheet();

  const order = findOrder(input.value);
  order ? renderOrder(order) : renderError();
}

button.addEventListener("click", checkStatus);
input.addEventListener("keydown", event => {
  if (event.key === "Enter") checkStatus();
});
