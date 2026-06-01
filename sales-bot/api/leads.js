import { notifyHotLead } from "../lib/shared.js";

export default async function handler(request, response) {
  if (request.method === "GET") {
    response.status(200).json({
      leads: null,
      leadStorage: "browser-local-storage",
      note: "Vercel serverless mode does not persist leads without a database."
    });
    return;
  }

  if (request.method === "POST") {
    const lead = request.body?.lead || {};
    if (lead.score >= 75 || lead.status === "Ready") {
      await notifyHotLead(lead).catch(() => {});
    }
    response.status(201).json({
      lead,
      leadStorage: "browser-local-storage",
      saved: true
    });
    return;
  }

  if (request.method === "DELETE") {
    response.status(200).json({ cleared: true });
    return;
  }

  response.status(405).json({ error: "Method not allowed" });
}
