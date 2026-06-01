const aiProvider = (process.env.AI_PROVIDER || "openai").toLowerCase();
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const webSearchEnabled = process.env.ENABLE_WEB_SEARCH !== "false";
const defaultServerSettings = {
  businessName: "SIN AI Sales Bot",
  industry: "AI automation and sales systems",
  mainOffer: "AI sales bots that answer customer questions, qualify buyers, collect lead details, and guide serious customers toward booking or payment",
  startingPrice: "Custom setup depending on the business, channel, and automation level",
  paymentMethods: "Mobile Money, bank transfer, or agreed business payment method",
  handoffRule: "Alert the owner when the customer asks for pricing, wants setup, shares contact details, or is ready to book/pay.",
  replyStyle: "Professional, direct, helpful, and short enough for WhatsApp. Ask one useful question at a time.",
  businessBackground: "SIN AI helps businesses use AI sales bots, automations, AI video, and AI systems to reduce manual work and convert more leads.",
  masterPrompt: "Always act as a practical AI sales assistant for this business. Use the business details as the source of truth. Never claim a service, price, guarantee, or contact is confirmed unless it is provided in the setup or grounded web results. If the user asks for leads, suppliers, companies, or B2B contacts, use internet search when available and include source links.",
  webSearch: "enabled",
  packages: "Starter website sales bot\nPro website bot with lead dashboard\nAdvanced bot with API, CRM, and WhatsApp/Instagram handoff",
  faqs: "Can this work for my business?\nCan it use OpenAI or Gemini?\nCan it collect leads?\nCan it work on my website?\nCan it connect to WhatsApp later?",
  objections: "Is this expensive?\nWill it replace my staff?\nCan it understand my customers?\nHow long does setup take?\nCan I test it first?"
};

export async function createBotReply(body) {
  const provider = getActiveProvider();
  const requestSettings = getRequestSettings(body.settings);
  if (provider === "demo") {
    return {
      source: "demo",
      reply: serverFallbackReply(body.message, requestSettings, body.lead),
      nextStage: "qualify",
      actions: ["Set up API key", "Add master prompt", "Try another search"],
      leadPatch: {}
    };
  }

  const webContext = await getWebContext(body, provider);
  const prompt = buildSalesPrompt(body, webContext);
  try {
    if (provider === "gemini") return normalizeBotResult(await createGeminiReply(prompt), requestSettings);
    return normalizeBotResult(await createOpenAiReply(prompt), requestSettings);
  } catch (error) {
    return normalizeBotResult({
      source: `${provider}-fallback`,
      reply: buildBusyProviderFallbackReply(body.message, requestSettings, webContext, error),
      nextStage: "qualify",
      actions: ["Refine search", "Try again", "Talk to owner"],
      leadPatch: {}
    }, requestSettings);
  }
}

export function getActiveProvider() {
  if (aiProvider === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (aiProvider === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "demo";
}

export async function notifyHotLead(lead) {
  if (!process.env.HOT_LEAD_WEBHOOK_URL) return;
  await fetch(process.env.HOT_LEAD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "hot_lead", lead })
  });
}

export function getSearchStatus() {
  return {
    enabled: webSearchEnabled,
    providers: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      gemini: Boolean(process.env.GEMINI_API_KEY),
      brave: Boolean(process.env.BRAVE_SEARCH_API_KEY)
    }
  };
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
          schema: openAiJsonSchema()
        }
      }
    })
  });

  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error(`OpenAI API error: ${apiResponse.status} ${detail}`);
  }

  const data = await apiResponse.json();
  return { source: "openai", ...JSON.parse(extractOutputText(data)) };
}

function normalizeBotResult(result, settings = {}) {
  const actions = Array.isArray(result.actions) && result.actions.length
    ? result.actions.slice(0, 4)
    : ["Tell me more", "Show pricing", "Talk to owner"];
  return {
    ...result,
    reply: repairReplyForBusinessIdentity(result.reply || "I can help with that. What do you need most right now?", settings),
    nextStage: result.nextStage || "qualify",
    actions,
    leadPatch: result.leadPatch || {}
  };
}

function repairReplyForBusinessIdentity(reply, settings = {}) {
  let fixed = String(reply || "");
  const businessName = settings.businessName || "";
  const mainOffer = settings.mainOffer || "";
  if (businessName && !/\bsin ai\b/i.test(businessName)) {
    fixed = fixed.replace(/\bSIN AI\b/g, businessName);
    fixed = fixed.replace(new RegExp(`\\b${escapeRegExp(businessName)}\\s+Sales Bot\\b`, "gi"), businessName);
  }
  if (mainOffer && !/\bsales bots?\b/i.test(mainOffer)) {
    fixed = fixed.replace(/\badvanced AI sales bots and automation systems\b/gi, mainOffer);
    fixed = fixed.replace(/\bAI sales bots and automation systems\b/gi, mainOffer);
    fixed = fixed.replace(/\bAI sales bots?\b/gi, mainOffer);
  }
  return applyRequestedWordLimit(fixed, settings);
}

function buildBusyProviderFallbackReply(message = "", settings = {}, webContext = "", error = {}) {
  if (webContext && !/live search failed|no search provider/i.test(webContext)) {
    const compactContext = webContext
      .split(/\n+/)
      .filter((line) => line.trim())
      .slice(0, 14)
      .join("\n")
      .slice(0, 1400);
    return `The AI model is busy, but I found live research context for your request:\n\n${compactContext}\n\nPlease verify details before outreach.`;
  }
  if (shouldSearchWeb(message, settings)) {
    return `Live search or the AI model is temporarily unavailable: ${error.message || "provider busy"}. Please try again in a moment, or add a dedicated Brave Search key for more reliable B2B research.`;
  }
  return `The AI model is temporarily busy. Please try again in a moment, or hand this lead to the owner if it is urgent.`;
}

function applyRequestedWordLimit(reply, settings = {}) {
  const instructionText = `${settings.masterPrompt || ""} ${settings.replyStyle || ""}`;
  const match = instructionText.match(/\b(?:under|below|max(?:imum)?|less than)\s+(\d{1,3})\s+words?\b/i);
  if (!match) return reply;
  const limit = Math.max(8, Number(match[1]));
  const words = reply.trim().split(/\s+/);
  if (words.length <= limit) return reply;
  return `${words.slice(0, limit).join(" ").replace(/[,.!?;:]*$/, "")}.`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        responseSchema: geminiJsonSchema()
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

async function getWebContext(body, provider) {
  const settings = getRequestSettings(body.settings);
  const latestMessage = body.message || "";
  if (!shouldSearchWeb(latestMessage, settings)) return "";

  const searchQuery = buildSearchQuery(latestMessage, settings);
  try {
    if (process.env.BRAVE_SEARCH_API_KEY) return await searchWithBrave(searchQuery);
    if (provider === "gemini" && process.env.GEMINI_API_KEY) return await searchWithGemini(searchQuery, settings);
    if (provider === "openai" && process.env.OPENAI_API_KEY) return await searchWithOpenAi(searchQuery, settings);
  } catch (error) {
    return `Internet search was requested, but live search failed: ${error.message}`;
  }
  return "Internet search was requested, but no search provider is configured. Enable Gemini/OpenAI search or add BRAVE_SEARCH_API_KEY on the server.";
}

function shouldSearchWeb(message = "", settings = {}) {
  if (!webSearchEnabled || settings.webSearch === "disabled") return false;
  return /\b(search|internet|web|google|find|look up|research|source|sources|latest|current|today|contacts?|leads?|b2b|suppliers?|companies|businesses|emails?|phone numbers?|whatsapp|directory|list of)\b/i.test(message);
}

function buildSearchQuery(message = "", settings = {}) {
  const businessContext = [settings.industry, settings.businessName].filter(Boolean).join(" ");
  return `${message} ${businessContext}`.replace(/\s+/g, " ").trim().slice(0, 240);
}

async function searchWithBrave(query) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "8");
  const apiResponse = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": process.env.BRAVE_SEARCH_API_KEY
    }
  });
  if (!apiResponse.ok) throw new Error(`Brave Search error: ${apiResponse.status}`);
  const data = await apiResponse.json();
  const results = (data.web?.results || []).slice(0, 8).map((result, index) => (
    `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.description || ""}`
  ));
  return results.length ? `Live web search results for "${query}":\n${results.join("\n\n")}` : `Live web search returned no results for "${query}".`;
}

async function searchWithOpenAi(query, settings) {
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      tools: [{ type: "web_search_preview" }],
      input: `Search the web for this request and return concise grounded notes with useful source URLs. Business context: ${settings.businessName || ""}, ${settings.industry || ""}. Request: ${query}`
    })
  });
  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error(`OpenAI web search error: ${apiResponse.status} ${detail}`);
  }
  const data = await apiResponse.json();
  return `Live web search notes for "${query}":\n${extractOutputText(data)}`;
}

async function searchWithGemini(query, settings) {
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
          parts: [{
            text: `Search the web for this request and return concise grounded notes with useful source URLs. Business context: ${settings.businessName || ""}, ${settings.industry || ""}. Request: ${query}`
          }]
        }
      ],
      tools: [{ googleSearch: {} }]
    })
  });
  if (!apiResponse.ok) {
    const detail = await apiResponse.text();
    throw new Error(`Gemini web search error: ${apiResponse.status} ${detail}`);
  }
  const data = await apiResponse.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  const urls = (data.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .map((chunk) => chunk.web?.uri)
    .filter(Boolean)
    .slice(0, 8);
  return `Live web search notes for "${query}":\n${text || "No notes returned."}\n\nSources:\n${urls.join("\n")}`;
}

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .join("")
    .trim();
}

function buildSalesPrompt(body, webContext = "") {
  const latestMessage = body.message || "";
  const cleaningAllowed = isCleaningContextAllowed(latestMessage);
  const settings = sanitizeSettingsContext(getRequestSettings(body.settings), cleaningAllowed);
  const lead = sanitizeLeadContext(body.lead || {}, cleaningAllowed);
  const conversation = sanitizeConversationContext((body.conversation || []).slice(-8), cleaningAllowed);
  return `You are the AI sales assistant for ${settings.businessName || "a business"}.

Master instruction from the business owner. Treat this as the highest-priority business behavior after safety and JSON-format rules:
${settings.masterPrompt || ""}

Business profile:
- Mandatory business name: ${settings.businessName || ""}
- Mandatory answer to "what do you sell?": ${settings.mainOffer || ""}
- Industry: ${settings.industry || ""}
- Main offer: ${settings.mainOffer || ""}
- Starting price: ${settings.startingPrice || ""}
- Payment methods: ${settings.paymentMethods || ""}
- Business background: ${settings.businessBackground || ""}
- Reply style: ${settings.replyStyle || ""}
- Internet search setting: ${settings.webSearch || "enabled"}
- Packages/services: ${settings.packages || ""}
- FAQs: ${settings.faqs || ""}
- Objections: ${settings.objections || ""}
- Handoff rule: ${settings.handoffRule || ""}

Live web context, if available:
${webContext || "No live web search context was used for this message."}

Current lead:
${JSON.stringify(lead)}

Recent conversation:
${JSON.stringify(conversation)}

Latest customer message:
${latestMessage}

Goal:
Reply like a professional sales assistant using the owner's master instruction as the highest-priority business rule. Answer clearly, ask one useful qualifying question, and push serious buyers toward booking/payment or human handoff. Do not invent unavailable prices, policies, business facts, contacts, phone numbers, emails, or source links. Keep replies short enough for WhatsApp unless the customer asks for a researched list.

Important guardrails:
- Follow the customized business setup. Do not force SIN AI if the owner configured another business.
- If the owner's master instruction gives a tone, word limit, business identity, or response format, obey it.
- If default example packages, FAQs, or objections conflict with the owner-entered business name, industry, main offer, background, or master instruction, ignore the default examples.
- If the customer asks for B2B contacts, suppliers, companies, leads, current information, or anything requiring the internet, use the live web context when present. Include source links and say when search was not available.
- Source links must be direct URLs copied from the live web context. Do not replace URLs with only source names.
- For contact lists, only provide contact names, phone numbers, emails, websites, or addresses found in live web context. If a detail is not grounded, leave it out.
- Do not mention cleaning, cleaning services, or cleaning leads unless the latest customer message explicitly asks about a cleaning business.
- If older conversation or lead notes mention cleaning but the latest customer message does not, treat that as stale demo context and ignore it.

Return only JSON that matches the schema.`;
}

function getRequestSettings(settings = {}) {
  const hasSettings = settings && typeof settings === "object" && Object.keys(settings).length > 0;
  if (!hasSettings) return { ...defaultServerSettings };
  return settings;
}

function isCleaningContextAllowed(latestMessage = "") {
  return /\b(clean|cleaning|cleaner|janitor|housekeeping)\b/i.test(latestMessage);
}

function sanitizeSettingsContext(settings = {}, cleaningAllowed) {
  if (cleaningAllowed) return settings;
  const hasCleaningProfile = Object.values(settings).some((value) => (
    typeof value === "string" && /\b(clean|cleaning|cleaner|janitor|housekeeping)\b/i.test(value)
  ));
  return hasCleaningProfile ? { ...defaultServerSettings } : settings;
}

function sanitizeLeadContext(lead = {}, cleaningAllowed) {
  if (cleaningAllowed) return lead;
  return removeCleaningTextFromObject(lead);
}

function sanitizeConversationContext(conversation = [], cleaningAllowed) {
  if (cleaningAllowed) return conversation;
  return conversation.map((message) => removeCleaningTextFromObject(message));
}

function removeCleaningTextFromObject(value) {
  if (Array.isArray(value)) return value.map(removeCleaningTextFromObject);
  if (!value || typeof value !== "object") return stripCleaningText(value);
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, stripCleaningText(entry)])
  );
}

function stripCleaningText(value) {
  if (typeof value !== "string") return value;
  if (!/\b(clean|cleaning|cleaner|janitor|housekeeping)\b/i.test(value)) return value;
  return "";
}

function serverFallbackReply(message = "", settings = {}, lead = {}) {
  const lower = message.toLowerCase();
  if (shouldSearchWeb(message, settings)) {
    return "Live internet search needs the backend AI/search API to be configured. Add Gemini/OpenAI or a Brave Search key on the server, then I can research current B2B contacts and include source links instead of guessing.";
  }
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

function openAiJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: sharedProperties(true),
    required: ["reply", "nextStage", "actions", "leadPatch"]
  };
}

function geminiJsonSchema() {
  return {
    type: "object",
    properties: sharedProperties(false),
    required: ["reply", "nextStage", "actions", "leadPatch"]
  };
}

function sharedProperties(includeAdditionalProperties) {
  const leadPatch = {
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
  };
  if (includeAdditionalProperties) leadPatch.additionalProperties = false;
  return {
    reply: { type: "string" },
    nextStage: { type: "string" },
    actions: { type: "array", items: { type: "string" } },
    leadPatch
  };
}
