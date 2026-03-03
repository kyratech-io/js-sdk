import { createHash } from "crypto";
import { GovernanceContext, getContext } from "./governance-context";
import {
  EvaluationDecision,
  ActionRequestPayload,
  EscalationStatus,
  AgentRegistrationRequest,
  AgentRegistrationResponse,
  ToolDefinition,
  KyraServerUnavailableException,
  PolicyDocument,
} from "./models";
import { KyraWrappedTool } from "./core/kyra-wrapped-tool";
import { GenericWrappedTool } from "./core/generic-wrapped-tool";
import { KyraToolNode } from "./plugins/langgraph";
import { KyraLangChainCallback } from "./plugins/langchain-callback";
import { SessionTracer } from "./session-tracer";

const SDK_VERSION = "1.0.0";

export type WrapFramework = "langchain" | "langgraph" | "crewai" | "alchemyst" | "generic";

const FRAMEWORK_WIRE: Record<WrapFramework, string> = {
  langchain: "LANGCHAIN",
  langgraph: "LANGGRAPH",
  crewai: "CREWAI",
  alchemyst: "ALCHEMYST",
  generic: "GENERIC",
};

export function normalizeFramework(f: WrapFramework | string): string {
  const key = (f ?? "").trim().toLowerCase() as WrapFramework;
  return FRAMEWORK_WIRE[key] ?? (key ? key.toUpperCase().replace(/-/g, "_") : "");
}

function tierOrder(tier: string): number {
  const order: Record<string, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4 };
  return order[tier] ?? -1;
}

export interface KyraGovernorConfig {
  apiKey: string;
  serverUrl?: string;
  timeoutMs?: number;
  failOpen?: boolean;
  mode?: string; // "enforce" | "shadow" — sent to server as ENFORCE | SHADOW
  agentId?: string;
  sessionIntent?: string;
  framework?: string;
}

export class KyraGovernor {
  private readonly config: Required<KyraGovernorConfig>;
  private registeredAgentId: string | null = null;
  private promptHash: string | null = null;
  private tracer = new SessionTracer();

  private _pollerAbort: AbortController | null = null;

  constructor(config: KyraGovernorConfig) {
    this.config = {
      serverUrl: "https://api.kyra.dev",
      timeoutMs: 5000,
      failOpen: true,
      mode: "",
      agentId: "",
      sessionIntent: "",
      framework: "LANGCHAIN_JS",
      ...config,
    };
    this._startEscalationPoller();
  }

  /**
   * Unified wrap: supports all frameworks via options.framework.
   * - framework "langchain" => [wrappedTools, KyraLangChainCallback]
   * - framework "langgraph" => pass a single ToolNode as first arg, returns KyraToolNode
   * - framework "crewai" | "alchemyst" | "generic" (default) => wrapped tools array
   */
  wrap(
    input: any[] | any,
    options?: { framework?: WrapFramework }
  ): any[] | [any[], import("./plugins/langchain-callback").KyraLangChainCallback] | import("./plugins/langgraph").KyraToolNode {
    const framework = (options?.framework ?? "generic") as WrapFramework;
    const wire = normalizeFramework(framework);

    if (framework === "langgraph") {
      const toolNode = Array.isArray(input) ? input[0] : input;
      return new KyraToolNode(toolNode, this) as any;
    }

    const tools = Array.isArray(input) ? input : [input];
    if (framework === "langchain") {
      const callback = new KyraLangChainCallback(this);
      callback.setTools(tools.map((t: any) => ({ name: t.name ?? String(t) })));
      const wrapped = tools.map((t: any) => new KyraWrappedTool(t, this, wire));
      return [wrapped, callback];
    }

    if (framework === "generic") {
      return tools.map((t: any) => new GenericWrappedTool(t, this));
    }

    return tools.map((t: any) => new KyraWrappedTool(t, this, wire));
  }

  /** @deprecated Use governor.wrap(toolNode, { framework: "langgraph" }) */
  wrapToolNode(toolNode: any): any {
    return new KyraToolNode(toolNode, this);
  }

  get Tracer(): SessionTracer {
    return this.tracer;
  }

  async registerAgent(
    agentName: string,
    systemPrompt: string,
    tools: ToolDefinition[],
    policies?: PolicyDocument[],
  ): Promise<string> {
    const sortedTools = [...tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        parametersSchema: t.parametersSchema ?? {},
        ...(t.requestedTier && { requestedTier: t.requestedTier }),
      }));
    const sourceHash =
      "sha256:" +
      createHash("sha256")
        .update(systemPrompt + JSON.stringify(sortedTools))
        .digest("hex");
    const payload: AgentRegistrationRequest = {
      agentName,
      systemPrompt,
      tools: sortedTools,
      framework: this.config.framework ?? "",
      sdkVersion: SDK_VERSION,
      sourceHash,
    };
    if (policies?.length) {
      payload.policies = policies;
    }
    const response = await this._post<AgentRegistrationResponse>(
      "/v1/agents/register",
      payload
    );
    this.registeredAgentId = response.agentId;
    this.promptHash =
      "sha256:" + createHash("sha256").update(systemPrompt).digest("hex");
    return response.agentId;
  }

  /** Returns { ok: true, blockReason: "" } for ALLOW; { ok: false, blockReason } for BLOCK/ESCALATE/server error. ESCALATE fires async POST to /v1/escalations. */
  async evaluate(
    toolName: string,
    toolDescription: string,
    parameters: Record<string, unknown>,
    requestedTier?: string,
    frameworkOverride?: WrapFramework | string
  ): Promise<{ ok: boolean; blockReason: string }> {
    return this._evaluateBeforeCall(toolName, toolDescription, parameters, requestedTier, frameworkOverride);
  }

  /** Single internal evaluation path — all framework adapters call this. */
  async _evaluateBeforeCall(
    toolName: string,
    toolDescription: string,
    parameters: Record<string, unknown>,
    requestedTier?: string,
    frameworkOverride?: WrapFramework | string
  ): Promise<{ ok: boolean; blockReason: string }> {
    const ctx = getContext();
    const framework = frameworkOverride ? normalizeFramework(frameworkOverride as WrapFramework) : this.config.framework;
    const payload: ActionRequestPayload = {
      toolName,
      toolDescription,
      parameters,
      agentId: this.registeredAgentId ?? (this.config.agentId || undefined),
      governanceContext: ctx?.toDto() ?? this._emptyCtx(),
      sessionIntent: this.config.sessionIntent || undefined,
      framework,
      sdkVersion: SDK_VERSION,
      ...(this.promptHash && { promptHash: this.promptHash }),
      ...(requestedTier && { requestedTier }),
    };
    const mode = this._normalizeMode(this.config.mode);
    if (mode) payload.mode = mode;
    const agentTrace = this.tracer.buildAgentTrace();
    if (agentTrace) payload.agentTrace = agentTrace;

    let decision: EvaluationDecision;
    try {
      decision = await this._post<EvaluationDecision>("/v1/evaluate", payload);
    } catch (e: any) {
      if (this.config.failOpen && (e.name === "AbortError" || e.code === "ECONNREFUSED" || e.code === "ECONNRESET")) {
        return { ok: true, blockReason: "" };
      }
      return { ok: false, blockReason: e?.message ?? "server error" };
    }

    const { ok, blockReason } = this._handleDecision(decision);
    if (!ok && decision.outcome === "ESCALATE" && decision.escalationId) {
      this._postEscalationAsync(toolName, toolDescription, parameters, requestedTier ?? "", decision);
    }
    if (ok && ctx) {
      ctx.aggregateActionCount += 1;
      if (decision.tier && tierOrder(decision.tier) > tierOrder(ctx.highestTierInChain)) {
        ctx.highestTierInChain = decision.tier;
      }
    }
    return { ok, blockReason };
  }

  private _postEscalationAsync(
    toolName: string,
    toolDescription: string,
    parameters: Record<string, unknown>,
    tier: string,
    decision: EvaluationDecision
  ): void {
    const body = {
      toolName,
      toolDescription,
      parameters,
      tier,
      blockReason: decision.blockReason,
      traceId: decision.traceId,
      sessionId: decision.evaluationId,
      escalationId: decision.escalationId,
    };
    fetch(`${this.config.serverUrl}/v1/escalations`, {
      method: "POST",
      headers: { "X-Kyra-Key": this.config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  private _startEscalationPoller(): void {
    this._pollerAbort = new AbortController();
    const interval = setInterval(async () => {
      if (this._pollerAbort?.signal.aborted) {
        clearInterval(interval);
        return;
      }
      const agentId = this.registeredAgentId ?? this.config.agentId;
      if (!agentId) return;
      try {
        const list = await this._get<EscalationStatus[]>(
          `/v1/escalations?status=approved&agentId=${encodeURIComponent(agentId)}`
        );
        const items = Array.isArray(list) ? list : (list as any)?.escalations ?? [];
        for (const es of items) {
          if (es.status !== "APPROVED") continue;
          await this._post(`/v1/agents/${agentId}/graph/rules`, {});
          await fetch(`${this.config.serverUrl}/v1/escalations/${es.escalationId}`, {
            method: "PATCH",
            headers: { "X-Kyra-Key": this.config.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ status: "processed" }),
          }).catch(() => {});
        }
      } catch {
        // ignore
      }
    }, 30_000);
  }

  private async _post<T>(path: string, body: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.config.timeoutMs);
    try {
      const resp = await fetch(`${this.config.serverUrl}${path}`, {
        method: "POST",
        headers: {
          "X-Kyra-Key": this.config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`Kyra server error ${resp.status}`);
      return resp.json() as Promise<T>;
    } catch (e: any) {
      clearTimeout(timer);
      if (
        e.name === "AbortError" ||
        e.code === "ECONNREFUSED" ||
        e.code === "ECONNRESET"
      ) {
        if (this.config.failOpen) {
          return {
            outcome: "ALLOW",
            source: "FAIL_OPEN",
            traceId: "",
            evaluationId: "",
            orgId: "",
            mode: "SHADOW",
            shadowOutcome: undefined,
            tier: "T0",
            evaluationMs: 0,
            gateResults: [],
          } as unknown as T;
        }
        throw new KyraServerUnavailableException(e.message);
      }
      throw e;
    }
  }

  private async _get<T>(path: string): Promise<T> {
    const resp = await fetch(`${this.config.serverUrl}${path}`, {
      headers: { "X-Kyra-Key": this.config.apiKey },
    });
    return resp.json() as Promise<T>;
  }

  private _handleDecision(decision: EvaluationDecision): { ok: boolean; blockReason: string } {
    switch (decision.outcome) {
      case "ALLOW":
        return { ok: true, blockReason: "" };
      case "BLOCK":
        return { ok: false, blockReason: decision.blockReason ?? "Action blocked by Kyra policy" };
      case "ESCALATE":
        return { ok: false, blockReason: decision.blockReason || "escalation required" };
      case "RETURN_TO_USER":
        return { ok: false, blockReason: `missing parameters: ${decision.missingParameters?.join(", ") ?? ""}` };
      default:
        return { ok: false, blockReason: decision.outcome };
    }
  }

  private _normalizeMode(mode: string): string {
    const m = (mode ?? "").trim().toLowerCase();
    if (m === "enforce") return "ENFORCE";
    if (m === "shadow") return "SHADOW";
    return "";
  }

  private _emptyCtx(): import("./models").GovernanceContextDto {
    return {
      traceId: "",
      rootAgentId: "",
      originalIntentVerbatim: "",
      originalIntentHash: "",
      chainDepth: 0,
      aggregateRowsAffected: 0,
    };
  }
}
