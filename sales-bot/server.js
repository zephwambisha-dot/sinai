import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createBotReply as createSharedBotReply, getActiveProvider as getSharedActiveProvider, getSearchStatus } from "./lib/shared.js";

loadLocalEnv();

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(rootDir, "data");
const leadsFile = join(dataDir, "leads.json");
const port = Number(process.env.PORT || 8088);
const aiProvider = (process.env.AI_PROVIDER || "openai").toLowerCase();
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/health") {
      return sendJson(response, 200, {
        ok: true,
        mode: getSharedActiveProvider(),
        configuredProvider: aiProvider,
        webSearch: getSearchStatus(),
        leadStorage: "server-json"
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await createSharedBotReply(body);
      return sendJson(response, 200, result);
    }

    if (url.pathname === "/api/leads" && request.method === "GET") {
      return sendJson(response, 200, { leads: await readLeads() });
    }

    if (url.pathname === "/api/leads" && request.method === "POST") {
      const body = await readJsonBody(request);
      const lead = {
        ...body.lead,
        id: body.lead?.id || randomUUID(),
        savedAt: body.lead?.savedAt || new Date().toISOString()
      };
      const leads = await readLeads();
      leads.unshift(lead);
      await writeLeads(leads);
      if (lead.score >= 75 || lead.status === "Ready") notifyHotLead(lead).catch(() => {});
      return sendJson(response, 201, { lead, leads });
    }

    if (url.pathname === "/api/leads" && request.method === "DELETE") {
      await writeLeads([]);
      return sendJson(response, 200, { leads: [] });
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendJson(response, 500, { error: "Server error", detail: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`SIN AI Sales Bot running at http://127.0.0.1:${port}`);
});

function loadLocalEnv() {
  const envPath = fileURLToPath(new URL(".env", import.meta.url));
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const filePath = normalize(join(rootDir, requested));
  if (!filePath.startsWith(rootDir)) return sendText(response, 403, "Forbidden");

  try {
    const data = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(data);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function createBotReply(body) {
  const provider = getActiveProvider();
  if (provider === "demo") {
    return {
      source: "demo",
      reply: serverFallbackReply(body.message, body.settings, body.lead),
      leadPatch: {}
    };
  }

  const prompt = buildSalesPrompt(body);
  if (provider === "gemini") return createGeminiReply(prompt);
  return createOpenAiReply(prompt);
}

function getActiveProvider() {
  if (aiProvider === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (aiProvider === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "demo";
}

async function createOpenAiReply(prompt) {
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "sales_bot_reply",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              reply: { type: "string" },
              nextStage: { type: "string" },
              actions: { type: "array", items: { type: "string" } },
              leadPatch: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: "string" },
                  need: { type: "string" },
                  timeframe: { type: "string" },
                  budget: { type: "string" },
                  contact: { type: "string" },
                  status: { type: "string" },
                  nextAction: { type: "string" }
                },
                required: ["name", "need", "timeframe", "budget", "contact", "status", "nextAction"]
              }
            },
            required: ["reply", "nextStage", "actions", "leadPatch"]
          }
        }
      }
    })
  });

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error(`OpenAI API error: ${apiResponse.status} ${detail}`);
  }

  const data = await apiResponse.json();
  return { source: "openai", ...JSON.parse(data.output_text) };
}

async function createGeminiReply(prompt) {
  const apiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": process.env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: salesBotJsonSchema()
      }
    })
  });

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error(`Gemini API error: ${apiResponse.status} ${detail}`);
  }

  const data = await apiResponse.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Gemini API returned no text");
  return { source: "gemini", ...JSON.parse(text) };
}

function salesBotJsonSchema() {
  return {
    type: "object",
    properties: {
      reply: { type: "string" },
      nextStage: { type: "string" },
      actions: { type: "array", items: { type: "string" } },
      leadPatch: {
        type: "object",
        properties: {
          name: { type: "string" },
          need: { type: "string" },
          timeframe: { type: "string" },
          budget: { type: "string" },
          contact: { type: "string" },
          status: { type: "string" },
          nextAction: { type: "string" }
        },
        required: ["name", "need", "timeframe", "budget", "contact", "status", "nextAction"]
      }
    },
    required: ["reply", "nextStage", "actions", "leadPatch"]
  };
}

function buildSalesPrompt(body) {
  const settings = body.settings || {};
  const lead = body.lead || {};
  const conversation = (body.conversation || []).slice(-8);
  return `You are the SIN AI Sales Bot for ${settings.businessName || "a business"}.

Business profile:
- Industry: ${settings.industry || ""}
- Main offer: ${settings.mainOffer || ""}
- Starting price: ${settings.startingPrice || ""}
- Payment methods: ${settings.paymentMethods || ""}
- Packages/services: ${settings.packages || ""}
- FAQs: ${settings.faqs || ""}
- Objections: ${settings.objections || ""}
- Handoff rule: ${settings.handoffRule || ""}

Current lead:
${JSON.stringify(lead)}

Recent conversation:
${JSON.stringify(conversation)}

Latest customer message:
${body.message || ""}

Goal:
Reply like a professional sales assistant. Answer clearly, ask one useful qualifying question, and push serious buyers toward booking/payment or human handoff. Do not invent unavailable prices or policies. Keep replies short enough for WhatsApp.

Return only JSON that matches the schema.`;
}

function serverFallbackReply(message = "", settings = {}, lead = {}) {
  const lower = message.toLowerCase();
  if (/\b(price|cost|how much|quote)\b/.test(lower)) {
    return `Our pricing ${settings.startingPrice || "depends on the job"}. To quote correctly, what exactly do you need, where are you located, and when do you need it?`;
  }
  if (/\b(book|pay|ready|confirm|payment)\b/.test(lower)) {
    return `Great. Payment can be made by ${settings.paymentMethods || "the available payment method"}. Please send your name, phone number, location, and exact service so we can finalize.`;
  }
  if (/\b(service|offer|do you)\b/.test(lower)) {
    return `We help with ${settings.mainOffer || "our main services"}. What exactly do you need help with today?`;
  }
  if (!lead?.timeframe) return "Noted. When do you need this done: today, tomorrow, this week, or another date?";
  if (!lead?.contact) return "Good. Please share your phone number or WhatsApp contact so the owner can confirm details.";
  return "Thanks. This looks like a serious inquiry. Would you like to proceed with booking or payment now?";
}

async function readLeads() {
  try {
    return JSON.parse(await readFile(leadsFile, "utf8"));
  } catch {
    return [];
  }
}

async function writeLeads(leads) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(leadsFile, JSON.stringify(leads, null, 2));
}

async function notifyHotLead(lead) {
  if (!process.env.HOT_LEAD_WEBHOOK_URL) return;
  await fetch(process.env.HOT_LEAD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "hot_lead", lead })
  });
}

function sendJson(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(text);
}
