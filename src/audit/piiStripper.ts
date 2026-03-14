/**
 * PII stripping for LLM request/response bodies before audit.
 */

const REDACTED = "[REDACTED]";

function redactMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (!msg || typeof msg !== "object") return msg;
    const copy = { ...(msg as Record<string, unknown>) };
    if ((copy as Record<string, unknown>).role === "user" && "content" in copy) {
      copy.content = REDACTED;
    }
    return copy;
  });
}

function redactTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...obj };
  if ("prompt" in out) out.prompt = REDACTED;
  if ("input" in out) out.input = REDACTED;
  if ("messages" in out) out.messages = redactMessages(out.messages);
  return out;
}

export function extractUserId(body: string | Buffer | null | undefined): string | null {
  if (body == null) return null;
  try {
    const text = typeof body === "string" ? body : (body as Buffer).toString("utf8");
    if (!text) return null;
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return null;
    for (const field of ["user", "userId", "user_id"]) {
      const val = (data as Record<string, unknown>)[field];
      if (typeof val === "string" && val) return val;
    }
  } catch {
    // ignore
  }
  return null;
}

export function piiStrip(body: string | Buffer | null | undefined): Record<string, unknown> {
  if (body == null) return {};
  try {
    const text = typeof body === "string" ? body : (body as Buffer).toString("utf8");
    if (!text) return {};
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") return {};
    return redactTopLevel(data as Record<string, unknown>);
  } catch {
    return {};
  }
}
