import type { KyraGovernor } from "../governor";
import { ErrGovernanceBlock } from "../models";

/**
 * Wraps any duck-typed tool with name, description, and invoke or call method.
 * Used when framework is "generic". All evaluation goes through governor._evaluateBeforeCall.
 */
export class GenericWrappedTool {
  constructor(
    private readonly tool: { name: string; description: string; invoke?: (input: Record<string, unknown>) => Promise<any>; call?: (input: Record<string, unknown>) => Promise<any>; requestedTier?: string },
    private readonly governor: KyraGovernor
  ) {}

  get name(): string {
    return this.tool.name;
  }
  get description(): string {
    return this.tool.description;
  }
  get schema(): unknown {
    return (this.tool as any).schema;
  }

  async invoke(input: Record<string, unknown>, _config?: any): Promise<any> {
    const requestedTier = (this.tool as any).requestedTier;
    const { ok, blockReason } = await this.governor._evaluateBeforeCall(
      this.tool.name,
      this.tool.description,
      input,
      requestedTier,
      "GENERIC"
    );
    if (!ok) throw new ErrGovernanceBlock(blockReason);
    const start = Date.now();
    try {
      const fn = this.tool.invoke ?? this.tool.call;
      if (typeof fn !== "function") throw new Error("Tool must have invoke or call method");
      const result = await fn.call(this.tool, input);
      const executionTimeMs = Date.now() - start;
      this.governor.Tracer.recordToolResult(
        this.tool.name,
        String(result),
        executionTimeMs,
        true,
        this.governor.Tracer.nextSequence()
      );
      return result;
    } catch (e) {
      const executionTimeMs = Date.now() - start;
      this.governor.Tracer.recordToolResult(
        this.tool.name,
        "",
        executionTimeMs,
        false,
        this.governor.Tracer.nextSequence()
      );
      throw e;
    }
  }

  async _call(input: Record<string, unknown>): Promise<string> {
    const result = await this.invoke(input);
    return typeof result === "string" ? result : JSON.stringify(result);
  }
}
