import type { AgentTrace } from "./session-tracer";

// Wire format — field names must match Java server DTOs exactly
export interface GovernanceContextDto {
  traceId: string;
  rootAgentId: string;
  originalIntentVerbatim: string;
  originalIntentHash: string;
  chainDepth: number;
  aggregateRowsAffected: number;
  aggregateActionCount?: number;
  highestTierInChain?: string;
  sessionId?: string;
  parentTraceId?: string;
  parentAgentId?: string;
}

export interface ActionRequestPayload {
  toolName: string;
  toolDescription: string;
  parameters: Record<string, unknown>;
  agentId?: string;
  governanceContext: GovernanceContextDto;
  sessionIntent?: string;
  framework: string;
  sdkVersion: string;
  promptHash?: string;
  agentTrace?: AgentTrace;
  requestedTier?: string; // floor hint; server uses max(llmClassified, requested)
  mode?: string; // ENFORCE | SHADOW — request server to use this mode
}

export interface GateResultDto {
  gate: string;
  passed: boolean;
  failureReason?: string;
  durationMs: number;
}

export interface EvaluationDecision {
  traceId: string;
  evaluationId: string;
  orgId: string;
  outcome: "ALLOW" | "BLOCK" | "ESCALATE" | "RETURN_TO_USER";
  mode: "SHADOW" | "ENFORCE";
  shadowOutcome?: string;
  tier: "T0" | "T1" | "T2" | "T3" | "T4";
  blockReason?: string;
  missingParameters?: string[];
  escalationId?: string;
  evaluationMs: number;
  gateResults: GateResultDto[];
  source?: "FAIL_OPEN"; // set when server unreachable + failOpen=true
}

export interface EscalationStatus {
  escalationId: string;
  status: "PENDING" | "APPROVED" | "DENIED";
}

export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema?: Record<string, unknown>;
  requestedTier?: string; // floor hint for this tool
}

export interface AgentRegistrationRequest {
  agentName: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  framework: string;
  sdkVersion: string;
  sourceHash: string;
  policies?: PolicyDocument[];
}

export interface AgentRegistrationResponse {
  agentId: string;
}

export interface PolicyDocument {
  policyId: string;
  description: string;
  appliesToTools: string[];
  condition: string;
  action: 'BLOCK' | 'ESCALATE';
  tier: 'T0' | 'T1' | 'T2' | 'T3' | 'T4';
}

// Exception classes
export class KyraException extends Error {
  constructor(message: string, public readonly decision?: EvaluationDecision) {
    super(message);
    this.name = "KyraException";
  }
}

export class KyraBlockedException extends KyraException {
  constructor(message: string, decision?: EvaluationDecision) {
    super(message, decision);
    this.name = "KyraBlockedException";
  }
}

export class KyraEscalationDeniedException extends KyraException {
  constructor(message: string, decision?: EvaluationDecision) {
    super(message, decision);
    this.name = "KyraEscalationDeniedException";
  }
}

export class KyraReturnToUserException extends KyraException {
  get missingParameters(): string[] {
    return this.decision?.missingParameters ?? [];
  }
}

export class KyraServerUnavailableException extends KyraException {}

/** Single exported governance error. Thrown by wrapped tools when the action is blocked (BLOCK, ESCALATE, server error). */
export class ErrGovernanceBlock extends Error {
  constructor(public readonly msg: string) {
    super(msg ? `kyra: ${msg}` : "kyra: blocked");
    this.name = "ErrGovernanceBlock";
  }
}
