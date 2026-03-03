/**
 * LangChain JS callback that captures LLM reasoning and tool results for governance.
 * Add to AgentExecutor / runnable: callbacks=[new KyraLangChainCallback(governor)]
 */
import type { KyraGovernor } from "../governor";

type Serialized = Record<string, unknown>;
type Message = { role?: string; content?: string; type?: string };

export class KyraLangChainCallback {
  private _governor: KyraGovernor;
  private _llmStartTime = 0;
  private _toolStartTime = 0;
  private _currentToolName = "";
  private _tools: { name: string }[] = [];

  constructor(governor: KyraGovernor) {
    this._governor = governor;
  }

  setTools(tools: { name: string }[]): void {
    this._tools = tools;
  }

  handleChatModelStart(
    _serialized: Serialized,
    messages: Message[][],
    _runId?: string,
    _parentRunId?: string,
    _extra?: unknown,
    _tags?: string[],
    _metadata?: unknown,
    _runName?: string
  ): void {
    try {
      this._llmStartTime = Date.now();
      const flat: { role: string; content: string }[] = [];
      for (const group of messages) {
        for (const msg of group) {
          const role =
            (msg as any).type ?? (msg as any).role ?? "user";
          let content = (msg as any).content ?? "";
          if (Array.isArray(content)) {
            content = content
              .map((p: any) => (typeof p === "object" && p?.text ? p.text : String(p)))
              .join(" ");
          }
          flat.push({ role: String(role), content: String(content) });
        }
      }
      const model =
        String((_serialized as any).kwargs?.model_name ?? (_serialized as any).kwargs?.model ?? "unknown");
      const toolsOffered = this._tools.map((t) => t.name);
      const temp = (_serialized as any).kwargs?.temperature as number | undefined;
      const maxTokens = (_serialized as any).kwargs?.max_tokens as number | undefined;
      this._governor.Tracer.trackLLMInput(
        model,
        flat,
        toolsOffered,
        temp,
        maxTokens
      );
    } catch {
      // swallow
    }
  }

  handleLLMEnd(
    output: any,
    _runId?: string,
    _parentRunId?: string,
    _tags?: string[],
    _extra?: unknown
  ): void {
    try {
      const latencyMs = Date.now() - this._llmStartTime;
      let responseText = "";
      let thinkingText = "";
      let finishReason = "stop";
      let inputTokens = 0;
      let outputTokens = 0;
      let thinkingTokens = 0;
      const generations = output?.generations ?? [[]];
      const first = generations?.[0]?.[0];
      if (first) {
        responseText = first?.text ?? "";
        const msg = first?.message;
        if (msg) {
          thinkingText = msg?.thinking ?? msg?.additional_kwargs?.thinking ?? "";
          finishReason = msg?.response_metadata?.finish_reason ?? "stop";
        }
      }
      const usage = output?.llm_output?.token_usage ?? {};
      inputTokens = usage.prompt_tokens ?? 0;
      outputTokens = usage.completion_tokens ?? 0;
      thinkingTokens =
        usage.reasoning_tokens ??
        usage.completion_tokens_details?.reasoning_tokens ??
        0;
      this._governor.Tracer.trackLLMOutput(
        responseText,
        thinkingText,
        finishReason,
        inputTokens,
        outputTokens,
        thinkingTokens,
        latencyMs
      );
    } catch {
      // swallow
    }
  }

  handleAgentAction(action: any): void {
    try {
      const rationale = action?.log ?? "";
      this._governor.Tracer.setChosenToolRationale(String(rationale).trim());
    } catch {
      // swallow
    }
  }

  handleToolStart(
    _serialized: Serialized,
    _inputStr: string,
    _runId?: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: unknown,
    _runName?: string
  ): void {
    try {
      this._toolStartTime = Date.now();
      this._currentToolName =
        String((_serialized as any).name ?? "unknown");
    } catch {
      // swallow
    }
  }

  handleToolEnd(output: string): void {
    try {
      const execMs = Date.now() - this._toolStartTime;
      this._governor.Tracer.recordToolResult(
        this._currentToolName || "unknown",
        String(output),
        execMs,
        true,
        this._governor.Tracer.nextSequence()
      );
    } catch {
      // swallow
    }
  }

  handleToolError(error: Error): void {
    try {
      const execMs = Date.now() - this._toolStartTime;
      this._governor.Tracer.recordToolResult(
        this._currentToolName || "unknown",
        "",
        execMs,
        false,
        this._governor.Tracer.nextSequence()
      );
    } catch {
      // swallow
    }
  }

  handleLLMError(_error: Error): void {
    try {
      this._governor.Tracer.clearCurrentLLMCall();
    } catch {
      // swallow
    }
  }
}
