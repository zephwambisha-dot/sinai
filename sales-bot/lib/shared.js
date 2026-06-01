const aiProvider = (process.env.AI_PROVIDER || "openai").toLowerCase();
const openAiModel = process.env.OPENAI_MODEL || "gpt-5.2";
const geminiModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";

export async function createBotReply(body) {
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
