// Patches globalThis.fetch to inject Kyra headers and capture LLM/memory audit.
// Call activate() once after setting a GovernanceContext.

import { getContext } from "../governance-context";
import { getAuditQueue } from "../audit/auditQueue";
import { isLlmCall, extractModelFromRequest } from "../audit/llmClassifier";
import { piiStrip, extractUserId } from "../audit/piiStripper";

let _originalFetch: typeof fetch | null = null;
let _active = false;
let _llmEndpoints: string[] = [];
let _memoryEndpoints: string[] = [];

export function configureEndpoints(llmEndpoints?: string[], memoryEndpoints?: string[]): void {
  _llmEndpoints = llmEndpoints ?? [];
  _memoryEndpoints = memoryEndpoints ?? [];
}

function isMemoryCall(url: string): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return _memoryEndpoints.some((p) => u.includes(p.toLowerCase()));
}

function memoryEventType(method: string): string {
  const m = (method || "GET").toUpperCase();
  if (m === "GET") return "MEMORY_READ";
  if (m === "POST" || m === "PUT") return "MEMORY_WRITE";
  if (m === "PATCH") return "MEMORY_UPDATE";
  if (m === "DELETE") return "MEMORY_DELETE";
  return "MEMORY_READ";
}

function classifyAndAudit(
  url: string,
  method: string,
  requestBody: string | null,
  responseBody: string | null,
  elapsedMs: number
): void {
  try {
    const ctx = getContext();
    const sessionId = ctx?.sessionId ?? undefined;
    const agentId = ctx?.rootAgentId ?? undefined;

    if (isLlmCall(url, _llmEndpoints)) {
      const userId = extractUserId(requestBody);
      const strippedReq = piiStrip(requestBody);
      const strippedRes = piiStrip(responseBody);
      const model = extractModelFromRequest(requestBody);
      getAuditQueue().enqueueLlmRaw({
        agentId: agentId ?? null,
        sessionId: sessionId ?? null,
        userId: userId ?? null,
        url,
        requestBody: strippedReq,
        responseBody: strippedRes,
        latencyMs: elapsedMs,
        model,
      });
    }

    if (isMemoryCall(url)) {
      getAuditQueue().enqueueMemoryEvent({
        agentId: agentId ?? null,
        sessionId: sessionId ?? null,
        eventType: memoryEventType(method),
        sourceEndpoint: url,
        latencyMs: elapsedMs,
      });
    }
  } catch {
    // audit must never affect callers
  }
}

export function activate(): void {
  if (_active) return;
  _active = true;
  _originalFetch = globalThis.fetch;

  globalThis.fetch = function patchedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    const ctx = getContext();
    if (ctx) {
      const headers = new Headers(init?.headers);
      const ctxHeaders = ctx.toHeaders();
      Object.entries(ctxHeaders).forEach(([k, v]) => headers.set(k, v));
      init = { ...init, headers };
    }

    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    let reqBody: string | null = null;
    if (init?.body != null && typeof init.body === "string") reqBody = init.body;

    const start = Date.now();
    return _originalFetch!(input, init).then((response) => {
      const elapsedMs = Date.now() - start;
      const clone = response.clone();
      Promise.resolve()
        .then(() => clone.text())
        .then((resText) => classifyAndAudit(url, method, reqBody, resText, elapsedMs))
        .catch(() => {});
      return response;
    });
  };
}

export function deactivate(): void {
  if (!_active || !_originalFetch) return;
  _active = false;
  globalThis.fetch = _originalFetch;
  _originalFetch = null;
}
