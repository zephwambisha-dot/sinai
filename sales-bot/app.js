const STORAGE_KEYS = {
  settings: "sin-ai-sales-bot-settings",
  leads: "sin-ai-sales-bot-leads"
};

const defaultSettings = {
  businessName: "Kampala Cleaning Services",
  industry: "Cleaning company",
  mainOffer: "Home, office, sofa, carpet, and post-construction cleaning",
  startingPrice: "Starts from UGX 50,000 depending on the job",
  paymentMethods: "Mobile Money or bank transfer",
  handoffRule: "Call the owner when the customer wants same-day service, asks for a custom quote, or is ready to pay.",
  packages: "Basic home cleaning\nDeep cleaning\nOffice cleaning\nSofa and carpet cleaning\nPost-construction cleaning",
  faqs: "How much is cleaning?\nDo you clean offices?\nCan you come today?\nWhere are you located?\nDo you bring your own equipment?",
  objections: "I will get back to you\nYour price is high\nI need to ask someone\nCan you send pictures?\nI need it urgently"
};

const state = {
  view: "chat",
  settings: loadSettings(),
  leads: loadLeads(),
  conversation: [],
  stage: "start",
  lead: createEmptyLead()
};

const elements = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  bindEvents();
  populateSettingsForm();
  startConversation();
  renderAll();
  syncServerLeads();
});

function cacheElements() {
  elements.navTabs = document.querySelectorAll(".nav-tab");
  elements.views = {
    chat: document.getElementById("chatView"),
    leads: document.getElementById("leadsView"),
    setup: document.getElementById("setupView"),
    scripts: document.getElementById("scriptsView")
  };
  elements.chatWindow = document.getElementById("chatWindow");
  elements.quickActions = document.getElementById("quickActions");
  elements.messageForm = document.getElementById("messageForm");
  elements.messageInput = document.getElementById("messageInput");
  elements.leadStatusPill = document.getElementById("leadStatusPill");
  elements.leadName = document.getElementById("leadName");
  elements.leadNeed = document.getElementById("leadNeed");
  elements.leadTimeframe = document.getElementById("leadTimeframe");
  elements.leadBudget = document.getElementById("leadBudget");
  elements.leadContact = document.getElementById("leadContact");
  elements.leadScore = document.getElementById("leadScore");
  elements.ownerNotes = document.getElementById("ownerNotes");
  elements.saveLeadBtn = document.getElementById("saveLeadBtn");
  elements.leadsTable = document.getElementById("leadsTable");
  elements.totalLeads = document.getElementById("totalLeads");
  elements.hotLeads = document.getElementById("hotLeads");
  elements.bookings = document.getElementById("bookings");
  elements.businessNameHeading = document.getElementById("businessNameHeading");
  elements.businessIndustry = document.getElementById("businessIndustry");
  elements.settingsForm = document.getElementById("settingsForm");
  elements.saveSettingsBtn = document.getElementById("saveSettingsBtn");
  elements.resetDemoBtn = document.getElementById("resetDemoBtn");
  elements.exportLeadsBtn = document.getElementById("exportLeadsBtn");
  elements.clearLeadsBtn = document.getElementById("clearLeadsBtn");
  elements.scriptOutput = document.getElementById("scriptOutput");
  elements.copyScriptsBtn = document.getElementById("copyScriptsBtn");
}

function bindEvents() {
  elements.navTabs.forEach((tab) => {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  });

  elements.messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = elements.messageInput.value.trim();
    if (!message) return;
    elements.messageInput.value = "";
    handleCustomerMessage(message);
  });

  elements.saveLeadBtn.addEventListener("click", saveCurrentLead);
  elements.saveSettingsBtn.addEventListener("click", saveSettingsFromForm);
  elements.resetDemoBtn.addEventListener("click", resetConversation);
  elements.exportLeadsBtn.addEventListener("click", exportLeadsCsv);
  elements.clearLeadsBtn.addEventListener("click", clearLeads);
  elements.copyScriptsBtn.addEventListener("click", copyScripts);
}

function setView(view) {
  state.view = view;
  elements.navTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  Object.entries(elements.views).forEach(([key, node]) => node.classList.toggle("active", key === view));
  if (view === "scripts") renderScripts();
}

function loadSettings() {
  return readJson(STORAGE_KEYS.settings, defaultSettings);
}

function loadLeads() {
  return readJson(STORAGE_KEYS.leads, []);
}

function readJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function createEmptyLead() {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    name: "",
    need: "",
    timeframe: "",
    budget: "",
    contact: "",
    status: "New",
    score: 0,
    nextAction: "Qualify need",
    notes: "",
    createdAt: new Date().toISOString()
  };
}

function startConversation() {
  state.conversation = [];
  state.stage = "need";
  state.lead = createEmptyLead();
  addBotMessage(`Hi. This is ${state.settings.businessName}. I can help you choose the right service and confirm the next step. What do you need help with today?`);
  setQuickActions(["I need pricing", "I want to book", "What services do you offer?", "I need it today"]);
}

function resetConversation() {
  elements.ownerNotes.value = "";
  startConversation();
  renderAll();
}

function addBotMessage(text) {
  state.conversation.push({ sender: "bot", text });
}

function addUserMessage(text) {
  state.conversation.push({ sender: "user", text });
}

async function handleCustomerMessage(message) {
  addUserMessage(message);
  captureLeadData(message);
  const reply = await getBotReply(message);
  addBotMessage(reply.text);
  state.stage = reply.nextStage;
  setQuickActions(reply.actions);
  renderAll();
}

async function getBotReply(message) {
  const localReply = generateReply(message);
  if (!canUseApi()) return localReply;

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        settings: state.settings,
        conversation: state.conversation,
        lead: state.lead,
        stage: state.stage
      })
    });
    if (!response.ok) throw new Error("API reply failed");
    const data = await response.json();
    applyLeadPatch(data.leadPatch);
    updateScore();
    return {
      text: data.reply || localReply.text,
      nextStage: data.nextStage || localReply.nextStage,
      actions: Array.isArray(data.actions) && data.actions.length ? data.actions.slice(0, 4) : localReply.actions
    };
  } catch {
    return localReply;
  }
}

function canUseApi() {
  return location.protocol === "http:" || location.protocol === "https:";
}

function applyLeadPatch(patch = {}) {
  ["name", "need", "timeframe", "budget", "contact", "status", "nextAction"].forEach((key) => {
    if (patch[key]) state.lead[key] = String(patch[key]).trim();
  });
}

function captureLeadData(message) {
  const lower = message.toLowerCase();
  if (!state.lead.need && !isQuestionOnly(lower)) state.lead.need = cleanSentence(message);

  if (/\b(today|now|urgent|asap|tomorrow|this week|morning|evening|weekend)\b/i.test(message)) {
    state.lead.timeframe = extractTimeframe(message);
  }

  const moneyMatch = message.match(/(?:ugx|shs|kes|tzs|\$|usd)?\s?\d[\d,]*(?:k|m)?/i);
  if (moneyMatch && !state.lead.budget) {
    state.lead.budget = moneyMatch[0].trim();
  }

  const phoneMatch = message.match(/(?:\+?\d[\d\s-]{7,}\d)/);
  if (phoneMatch) {
    state.lead.contact = phoneMatch[0].trim();
  }

  const nameMatch = message.match(/(?:my name is|i am|i'm)\s+([a-z][a-z\s]{1,30})/i);
  if (nameMatch && !state.lead.name) {
    state.lead.name = titleCase(nameMatch[1].trim());
  }

  if (/\b(book|pay|start|send details|mobile money|bank|confirm|ready)\b/i.test(message)) {
    state.lead.status = "Ready";
  } else if (/\b(price|cost|how much|quote|interested|need|want)\b/i.test(message)) {
    state.lead.status = "Interested";
  }

  updateScore();
}

function isQuestionOnly(text) {
  return /^(hi|hello|hey|price|how much|cost|services|location|where)$/i.test(text.trim());
}

function cleanSentence(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 120);
}

function extractTimeframe(text) {
  const match = text.match(/\b(today|now|urgent|asap|tomorrow|this week|morning|evening|weekend)\b/i);
  return match ? titleCase(match[0]) : "Mentioned";
}

function generateReply(message) {
  const lower = message.toLowerCase();
  const settings = state.settings;

  if (/\b(hi|hello|hey)\b/.test(lower) && state.conversation.length <= 3) {
    return {
      text: `Hi. Thanks for contacting ${settings.businessName}. What service do you need and when do you need it?`,
      nextStage: "need",
      actions: ["I need pricing", "I want to book", "What services do you offer?"]
    };
  }

  if (/\b(service|offer|do you|what do you)\b/.test(lower)) {
    return {
      text: `We help with ${settings.mainOffer}. Main options include: ${inlineList(settings.packages)}. What exactly do you need?`,
      nextStage: "need",
      actions: ["Send me prices", "I need this today", "I want to book"]
    };
  }

  if (/\b(price|cost|how much|quote|charges)\b/.test(lower)) {
    return {
      text: `Our pricing ${settings.startingPrice}. To quote correctly, what do you need, where are you located, and when do you need it?`,
      nextStage: "qualify",
      actions: ["I need it today", "I want a custom quote", "Send payment details"]
    };
  }

  if (/\b(location|where)\b/.test(lower)) {
    return {
      text: `We can confirm availability based on your location. Please send your area and what service you need.`,
      nextStage: "qualify",
      actions: ["I need pricing", "I want to book", "Talk to owner"]
    };
  }

  if (/\b(book|start|confirm|ready|pay|payment|mobile money|bank)\b/.test(lower)) {
    state.lead.status = "Ready";
    updateScore();
    return {
      text: `Great. To confirm, payment can be made by ${settings.paymentMethods}. Please send your name, contact number, location, and the exact service you want. A team member can take over now to finalize.`,
      nextStage: "handoff",
      actions: ["My name is ...", "Talk to owner", "Send payment details"]
    };
  }

  if (/\b(expensive|high|too much|discount)\b/.test(lower)) {
    return {
      text: `I understand. The best option is to match the service to your budget and urgency. What budget are you working with, and what result do you need most?`,
      nextStage: "objection",
      actions: ["My budget is ...", "What is the cheapest option?", "Talk to owner"]
    };
  }

  if (!state.lead.timeframe) {
    return {
      text: `Noted. When do you need this done? Today, tomorrow, this week, or another date?`,
      nextStage: "timeframe",
      actions: ["Today", "Tomorrow", "This week", "Not urgent"]
    };
  }

  if (!state.lead.contact) {
    return {
      text: `Good. Please share your phone number or WhatsApp contact so the owner can confirm details and availability.`,
      nextStage: "contact",
      actions: ["I want to book", "Send prices again", "Talk to owner"]
    };
  }

  return {
    text: `Thanks. Based on what you shared, this looks like a serious inquiry. The next step is to confirm the exact package and payment/booking details. Would you like to proceed now?`,
    nextStage: "close",
    actions: ["Yes, I want to proceed", "Send payment details", "Talk to owner"]
  };
}

function inlineList(value) {
  return value.split(/\n+/).map((item) => item.trim()).filter(Boolean).slice(0, 5).join(", ");
}

function updateScore() {
  let score = 0;
  if (state.lead.need) score += 20;
  if (state.lead.timeframe) score += 20;
  if (state.lead.budget) score += 15;
  if (state.lead.contact) score += 25;
  if (state.lead.status === "Ready") score += 25;
  if (state.lead.status === "Interested") score += 10;
  state.lead.score = Math.min(score, 100);
  state.lead.nextAction = getNextAction();
}

function getNextAction() {
  if (!state.lead.need) return "Ask what they need";
  if (!state.lead.timeframe) return "Ask when they need it";
  if (!state.lead.contact) return "Collect phone/WhatsApp contact";
  if (state.lead.status === "Ready" || state.lead.score >= 75) return "Human should close payment or booking";
  return "Send price and qualification questions";
}

function setQuickActions(actions) {
  elements.quickActions.innerHTML = "";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action;
    button.addEventListener("click", () => handleCustomerMessage(action));
    elements.quickActions.appendChild(button);
  });
}

function renderAll() {
  renderHeader();
  renderChat();
  renderLeadSummary();
  renderLeads();
  renderMetrics();
  renderScripts();
}

function renderHeader() {
  elements.businessNameHeading.textContent = state.settings.businessName;
  elements.businessIndustry.textContent = state.settings.industry;
}

function renderChat() {
  elements.chatWindow.innerHTML = "";
  state.conversation.forEach((message) => {
    const node = document.createElement("div");
    node.className = `message ${message.sender}`;
    node.textContent = message.text;
    elements.chatWindow.appendChild(node);
  });
  elements.chatWindow.scrollTop = elements.chatWindow.scrollHeight;
}

function renderLeadSummary() {
  elements.leadName.textContent = state.lead.name || "Unknown";
  elements.leadNeed.textContent = state.lead.need || "Not captured";
  elements.leadTimeframe.textContent = state.lead.timeframe || "Not captured";
  elements.leadBudget.textContent = state.lead.budget || "Not captured";
  elements.leadContact.textContent = state.lead.contact || "Not captured";
  elements.leadScore.textContent = state.lead.score;
  elements.leadStatusPill.textContent = state.lead.status;
  elements.leadStatusPill.className = "status-pill";
  if (state.lead.score >= 75 || state.lead.status === "Ready") elements.leadStatusPill.classList.add("hot");
  else if (state.lead.score >= 40 || state.lead.status === "Interested") elements.leadStatusPill.classList.add("warm");
}

function renderLeads() {
  elements.leadsTable.innerHTML = "";
  if (!state.leads.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="6">No leads saved yet. Use the chat, then click Save Lead.</td>`;
    elements.leadsTable.appendChild(row);
    return;
  }

  state.leads.forEach((lead) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(lead.name || "Unknown")}</td>
      <td>${escapeHtml(lead.need || "Not captured")}</td>
      <td>${escapeHtml(lead.status)}</td>
      <td>${lead.score}</td>
      <td>${escapeHtml(lead.contact || "Not captured")}</td>
      <td>${escapeHtml(lead.nextAction)}</td>
    `;
    elements.leadsTable.appendChild(row);
  });
}

function renderMetrics() {
  elements.totalLeads.textContent = state.leads.length;
  elements.hotLeads.textContent = state.leads.filter((lead) => lead.score >= 75 || lead.status === "Ready").length;
  elements.bookings.textContent = state.leads.filter((lead) => lead.status === "Ready").length;
}

async function saveCurrentLead() {
  const lead = {
    ...state.lead,
    notes: elements.ownerNotes.value.trim(),
    savedAt: new Date().toISOString()
  };
  if (!lead.need && !lead.contact && !lead.notes) {
    alert("Chat with a customer or add owner notes before saving.");
    return;
  }
  state.leads.unshift(lead);
  saveJson(STORAGE_KEYS.leads, state.leads);
  await saveLeadToServer(lead);
  renderAll();
  alert("Lead saved.");
}

async function clearLeads() {
  if (!confirm("Clear all saved leads?")) return;
  state.leads = [];
  saveJson(STORAGE_KEYS.leads, state.leads);
  await clearServerLeads();
  renderAll();
}

async function syncServerLeads() {
  if (!canUseApi()) return;
  try {
    const response = await fetch("/api/leads");
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.leads)) {
      state.leads = data.leads;
      saveJson(STORAGE_KEYS.leads, state.leads);
      renderAll();
    }
  } catch {
    // Local file mode still works without the backend.
  }
}

async function saveLeadToServer(lead) {
  if (!canUseApi()) return;
  try {
    const response = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead })
    });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.leads)) {
      state.leads = data.leads;
      saveJson(STORAGE_KEYS.leads, state.leads);
    }
  } catch {
    // Keep the browser copy if the backend is offline.
  }
}

async function clearServerLeads() {
  if (!canUseApi()) return;
  try {
    await fetch("/api/leads", { method: "DELETE" });
  } catch {
    // Local clear already happened.
  }
}

function populateSettingsForm() {
  Object.entries(state.settings).forEach(([key, value]) => {
    const field = elements.settingsForm.elements[key];
    if (field) field.value = value;
  });
}

function saveSettingsFromForm() {
  const data = new FormData(elements.settingsForm);
  state.settings = { ...state.settings };
  data.forEach((value, key) => {
    state.settings[key] = String(value).trim();
  });
  saveJson(STORAGE_KEYS.settings, state.settings);
  startConversation();
  renderAll();
  alert("Bot setup saved.");
}

function exportLeadsCsv() {
  const rows = [
    ["Name", "Need", "Timeframe", "Budget", "Contact", "Status", "Score", "Next Action", "Notes", "Saved At"],
    ...state.leads.map((lead) => [
      lead.name,
      lead.need,
      lead.timeframe,
      lead.budget,
      lead.contact,
      lead.status,
      lead.score,
      lead.nextAction,
      lead.notes,
      lead.savedAt
    ])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "sin-ai-sales-bot-leads.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function renderScripts() {
  elements.scriptOutput.textContent = generateScripts();
}

function generateScripts() {
  const settings = state.settings;
  return `SIN AI SALES BOT SETUP

Business: ${settings.businessName}
Industry: ${settings.industry}
Main offer: ${settings.mainOffer}
Starting price: ${settings.startingPrice}
Payment methods: ${settings.paymentMethods}
Human handoff rule: ${settings.handoffRule}

CUSTOMER WELCOME
Hi. Thanks for contacting ${settings.businessName}. I can help you choose the right service and confirm the next step. What do you need help with today?

QUALIFICATION QUESTIONS
1. What service/product do you need?
2. When do you need it?
3. Where are you located?
4. What budget are you working with?
5. Are you ready to book/pay today if the offer fits?

PRICE REPLY
Our pricing ${settings.startingPrice}. To quote correctly, please share what you need, your location, and when you need it.

PAYMENT / BOOKING ASK
Great. To confirm this, payment can be made by ${settings.paymentMethods}. Please send your name, phone number, location, and the exact service you want so we can finalize.

OBJECTION REPLY
I understand. The best option is to match the service to your budget and urgency. What budget are you working with, and what result do you need most?

HUMAN HANDOFF
This looks like a serious inquiry. A team member should take over now to confirm details, payment, or booking.

OWNER NEXT STEPS
1. Save the lead.
2. Check lead score.
3. If score is 75+, call or message personally.
4. If ready, send payment/booking details.
5. If not ready, follow up later with a specific offer.`;
}

async function copyScripts() {
  await navigator.clipboard.writeText(elements.scriptOutput.textContent);
  alert("Scripts copied.");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleCase(value) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
