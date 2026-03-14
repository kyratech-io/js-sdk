import { createHash } from "crypto";

const MAX_PRIOR_TOOL_RESULTS = 5;
const MAX_MESSAGE_CONTENT_LEN = 2000;

export interface LLMMessage {
  role: string;
  content: string;
}

export interface LLMCallTrace {
  model?: string;
  inputMessages?: LLMMessage[];
  toolsOffered?: string[];
  temperature?: number;
  maxTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  latencyMs?: number;
  responseText?: string;
  thinkingText?: string;
  finishReason?: string;
  chosenToolRationale?: string;
}

export interface PriorToolResult {
  toolName: string;
  outputSummary?: string;
  outputHash?: string;
  executionTimeMs?: number;
  success: boolean;
  sequenceNumber: number;
  parameters?: Record<string, unknown>;
  timestampEpochMs?: number;
}

export interface AgentTrace {
  sequenceNumber: number;
  llmCall?: LLMCallTrace;
  priorToolResults?: PriorToolResult[];
}

function truncateMessage(m: LLMMessage): LLMMessage {
  let content = m.content ?? "";
  if (content.length > MAX_MESSAGE_CONTENT_LEN) {
    content = content.slice(0, MAX_MESSAGE_CONTENT_LEN) + "...[truncated]";
  }
  return { role: m.role, content };
}

function filterMessages(msgs: LLMMessage[]): LLMMessage[] {
  const system: LLMMessage[] = [];
  const others: LLMMessage[] = [];
  for (const m of msgs) {
    const truncated = truncateMessage(m);
    if (m.role === "system") system.push(truncated);
    else others.push(truncated);
  }
  if (others.length > 3) {
    return [...system, ...others.slice(-3)];
  }
  return [...system, ...others];
}

export class SessionTracer {
  private sequenceCounter = 0;
  private currentLLMCall: LLMCallTrace | null = null;
  private toolResults: PriorToolResult[] = [];

  private nextSeq(): number {
    this.sequenceCounter++;
    return this.sequenceCounter;
  }

  nextSequence(): number {
    this.sequenceCounter++;
    return this.sequenceCounter;
  }

  trackLLMInput(
    model: string,
    messages: LLMMessage[],
    toolsOffered: string[] = [],
    temperature?: number,
    maxTokens?: number
  ): void {
    try {
      this.nextSeq();
      this.currentLLMCall = {
        model,
        inputMessages: filterMessages(messages),
        toolsOffered,
        temperature,
        maxTokens,
      };
    } catch {
      // swallow
    }
  }

  trackLLMOutput(
    responseText: string,
    thinkingText: string,
    finishReason: string,
    inputTokens: number,
    outputTokens: number,
    thinkingTokens: number,
    latencyMs: number
  ): void {
    try {
      if (!this.currentLLMCall) this.currentLLMCall = {};
      this.nextSeq();
      this.currentLLMCall.responseText = responseText;
      this.currentLLMCall.thinkingText = thinkingText;
      this.currentLLMCall.finishReason = finishReason;
      this.currentLLMCall.inputTokens = inputTokens;
      this.currentLLMCall.outputTokens = outputTokens;
      this.currentLLMCall.thinkingTokens = thinkingTokens;
      this.currentLLMCall.latencyMs = latencyMs;
    } catch {
      // swallow
    }
  }

  setChosenToolRationale(rationale: string): void {
    try {
      if (this.currentLLMCall) {
        this.currentLLMCall.chosenToolRationale = rationale;
      }
    } catch {
      // swallow
    }
  }

  buildAgentTrace(): AgentTrace | undefined {
    try {
      const seq = this.nextSeq();
      const trace: AgentTrace = { sequenceNumber: seq };
      if (this.currentLLMCall) trace.llmCall = this.currentLLMCall;
      if (this.toolResults.length > 0) trace.priorToolResults = this.toolResults;
      if (!trace.llmCall && !trace.priorToolResults) return undefined;
      return trace;
    } catch {
      return undefined;
    }
  }

  recordToolResult(
    toolName: string,
    output: string,
    executionTimeMs: number,
    success: boolean,
    sequenceNumber: number,
    parameters?: Record<string, unknown>,
    timestampEpochMs?: number
  ): void {
    try {
      const summary =
        output.length > 500 ? output.slice(0, 500) : output;
      const outputHash =
        "sha256:" +
        createHash("sha256").update(output).digest("hex");
      const result: PriorToolResult = {
        toolName,
        outputSummary: summary,
        outputHash,
        executionTimeMs,
        success,
        sequenceNumber,
      };
      if (parameters != null) result.parameters = parameters;
      if (timestampEpochMs != null) result.timestampEpochMs = timestampEpochMs;
      this.toolResults.push(result);
      if (this.toolResults.length > MAX_PRIOR_TOOL_RESULTS) {
        this.toolResults = this.toolResults.slice(
          -MAX_PRIOR_TOOL_RESULTS
        );
      }
    } catch {
      // swallow
    }
  }

  clearCurrentLLMCall(): void {
    try {
      this.currentLLMCall = null;
    } catch {
      // swallow
    }
  }
}
