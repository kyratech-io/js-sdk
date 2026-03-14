import { createHash, randomUUID } from "crypto";
import { AsyncLocalStorage } from "async_hooks";
import { GovernanceContextDto, type AgentContext } from "./models";

export class GovernanceContext {
  readonly traceId: string;
  readonly rootAgentId: string;
  readonly originalIntentVerbatim: string;
  readonly originalIntentHash: string;
  readonly chainDepth: number;
  readonly aggregateRowsAffected: number;
  aggregateActionCount: number;
  readonly sessionId: string;
  readonly parentTraceId?: string;
  readonly parentAgentId?: string;
  /** Set after evaluate when server returns kyraEventId; used for tool-result audit. */
  lastKyraEventId: string | undefined;
  /** Optional agent context for audit. */
  agentContext: AgentContext | undefined;

  constructor(params: Partial<GovernanceContext> = {}) {
    this.traceId = params.traceId ?? randomUUID();
    this.rootAgentId = params.rootAgentId ?? "";
    this.originalIntentVerbatim = params.originalIntentVerbatim ?? "";
    this.originalIntentHash = params.originalIntentHash ?? "";
    this.chainDepth = params.chainDepth ?? 0;
    this.aggregateRowsAffected = params.aggregateRowsAffected ?? 0;
    this.aggregateActionCount = params.aggregateActionCount ?? 0;
    this.sessionId = params.sessionId ?? randomUUID();
    this.parentTraceId = params.parentTraceId;
    this.parentAgentId = params.parentAgentId;
    this.lastKyraEventId = params.lastKyraEventId;
    this.agentContext = params.agentContext;
  }

  static fromHumanMessage(message: string, rootAgentId = ""): GovernanceContext {
    const intent = message.trim();
    return new GovernanceContext({
      traceId: randomUUID(),
      rootAgentId,
      originalIntentVerbatim: intent,
      originalIntentHash: createHash("sha256").update(intent).digest("hex"),
      sessionId: randomUUID(),
      aggregateActionCount: 0,
    });
  }

  static fromAgentSpawn(parent: GovernanceContext, childAgentId: string): GovernanceContext {
    const intent = parent.originalIntentVerbatim;
    return new GovernanceContext({
      traceId: randomUUID(),
      rootAgentId: parent.rootAgentId,
      originalIntentVerbatim: intent,
      originalIntentHash: parent.originalIntentHash,
      chainDepth: parent.chainDepth,
      aggregateRowsAffected: parent.aggregateRowsAffected,
      sessionId: parent.sessionId,
      aggregateActionCount: 0,
      parentTraceId: parent.traceId,
      parentAgentId: childAgentId,
    });
  }

  toDto(): GovernanceContextDto {
    const dto: GovernanceContextDto = {
      traceId: this.traceId,
      rootAgentId: this.rootAgentId,
      originalIntentVerbatim: this.originalIntentVerbatim,
      originalIntentHash: this.originalIntentHash,
      chainDepth: this.chainDepth,
      aggregateRowsAffected: this.aggregateRowsAffected,
    };
    if (this.aggregateActionCount !== 0) dto.aggregateActionCount = this.aggregateActionCount;
    if (this.sessionId) dto.sessionId = this.sessionId;
     if (this.parentTraceId) dto.parentTraceId = this.parentTraceId;
     if (this.parentAgentId) dto.parentAgentId = this.parentAgentId;
    return dto;
  }

  toHeaders(): Record<string, string> {
    const payload = {
      traceId: this.traceId,
      rootAgentId: this.rootAgentId,
      originalIntentHash: this.originalIntentHash,
      chainDepth: this.chainDepth,
    };
    const headers: Record<string, string> = {
      "X-Kyra-Trace": this.traceId,
      "X-Kyra-Governance": Buffer.from(JSON.stringify(payload)).toString("base64"),
    };
    if (this.sessionId) headers["X-Kyra-Session"] = this.sessionId;
    return headers;
  }
}

// AsyncLocalStorage for context propagation (Node.js — async-safe, unlike ThreadLocal)
export const contextStorage = new AsyncLocalStorage<GovernanceContext>();

export function getContext(): GovernanceContext | undefined {
  return contextStorage.getStore();
}

export function runWithContext<T>(ctx: GovernanceContext, fn: () => T): T {
  return contextStorage.run(ctx, fn);
}

export function setAgentContext(agentContext: AgentContext | undefined): void {
  const ctx = contextStorage.getStore();
  if (ctx) ctx.agentContext = agentContext;
}

export function getAgentContext(): AgentContext | undefined {
  return contextStorage.getStore()?.agentContext;
}
