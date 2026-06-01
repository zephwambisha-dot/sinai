import { createBotReply } from "../lib/shared.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const result = await createBotReply(request.body || {});
    response.status(200).json(result);
  } catch (error) {
    response.status(500).json({ error: "Chat API error", detail: error.message });
  }
}
