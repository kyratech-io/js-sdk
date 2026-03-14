/**
 * Fire-and-forget audit queue. Background worker POSTs to Kyra audit endpoints.
 */

type AuditItem = { _endpoint: string; [k: string]: unknown };

let defaultServerUrl = "https://api.kyratech.io";
let defaultQueue: AuditQueue | null = null;

export function configure(serverUrl: string): void {
  defaultServerUrl = (serverUrl ?? defaultServerUrl).replace(/\/+$/, "") || defaultServerUrl;
}

export function getAuditQueue(): AuditQueue {
  if (defaultQueue != null) return defaultQueue;
  defaultQueue = new AuditQueue(defaultServerUrl);
  return defaultQueue;
}

const MAX_QUEUE_SIZE = 5000;

export class AuditQueue {
  private readonly serverUrl: string;
  private readonly q: AuditItem[] = [];
  private readonly maxSize = MAX_QUEUE_SIZE;
  private workerRunning = true;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/+$/, "") || "https://api.kyratech.io";
    this.startWorker();
  }

  private startWorker(): void {
    const run = async (): Promise<void> => {
      while (this.workerRunning) {
        const item = this.q.shift();
        if (!item) {
          await new Promise((r) => setTimeout(r, 50));
          continue;
        }
        const { _endpoint: endpoint, ...payload } = item;
        if (endpoint) {
          try {
            // await is internal to the worker loop — callers of enqueue() are never blocked
            await fetch(`${this.serverUrl}${endpoint}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(3000),
            });
          } catch {
            // Swallow — audit must not affect agents
          }
        }
      }
    };
    run();
  }

  enqueueLlmRaw(payload: Record<string, unknown>): void {
    this.enqueue("/api/v1/audit/llm-raw", payload);
  }

  enqueueMemoryEvent(payload: Record<string, unknown>): void {
    this.enqueue("/api/v1/audit/memory-event", payload);
  }

  enqueueSessionEvent(payload: Record<string, unknown>): void {
    this.enqueue("/api/v1/audit/session-event", payload);
  }

  enqueueToolResult(payload: Record<string, unknown>): void {
    this.enqueue("/api/v1/audit/tool-result", payload);
  }

  private enqueue(endpoint: string, payload: Record<string, unknown>): void {
    if (this.q.length >= this.maxSize) return;
    try {
      this.q.push({ ...payload, _endpoint: endpoint });
    } catch {
      // ignore
    }
  }
}
