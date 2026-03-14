/**
 * LLM provider detection for audit classification.
 */

export const LLM_PROVIDER_PATTERNS: string[] = [
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.cohere.com",
  "api.mistral.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.fireworks.ai",
  "inference.ai.azure.com",
  "bedrock-runtime.",
];

function iterPatterns(additional?: string[]): string[] {
  const patterns = [...LLM_PROVIDER_PATTERNS];
  if (additional?.length) patterns.push(...additional);
  return patterns;
}

export function isLlmCall(url: string, additional?: string[]): boolean {
  if (!url) return false;
  const urlLower = url.toLowerCase();
  for (const pattern of iterPatterns(additional)) {
    if (urlLower.includes(pattern.toLowerCase())) return true;
  }
  return false;
}

export function extractModelFromRequest(body: string | Buffer | null | undefined): string {
  if (body == null) return "unknown";
  try {
    const text = typeof body === "string" ? body : (body as Buffer).toString("utf8");
    if (!text) return "unknown";
    const data = JSON.parse(text);
    if (data && typeof data === "object" && typeof data.model === "string" && data.model) {
      return data.model;
    }
  } catch {
    // ignore
  }
  return "unknown";
}
