import { getActiveProvider, getSearchStatus } from "../lib/shared.js";

export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    mode: getActiveProvider(),
    configuredProvider: (process.env.AI_PROVIDER || "openai").toLowerCase(),
    webSearch: getSearchStatus(),
    leadStorage: "browser-local-storage",
    runtime: "vercel"
  });
}
